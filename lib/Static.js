"use strict";

const SandGrain = require('sand-grain');
const co = require('co');
const Q = require('q');
const path = require('path');
const crypto = require('crypto');
const HashMap = require('./HashMap');
const _ = require('lodash');
const compressor = require('yuicompressor');
const fs = require('fs');
const async = require('async');

class Static extends SandGrain {
  constructor() {
    super();
    this.name = this.configName = 'static';
    this.defaultConfig = require('./defaultConfig');
    this.version = require('../package').version;
  }

  /**
   * On init we create a HashMap of all files
   *
   * @param {Object} config
   * @param {Function} done
   */
  init(config, done) {
    super.init(config);
    var self = this;

    co(function *() {
      self.hm = yield HashMap.createMap(path.normalize(sand.appPath + '/' + self.config.path));
      done();
    });
  }

  /**
   * Middleware used to load files from cache
   *
   * @param {Object} req
   * @param {Object} res
   * @param {Function} next
   * @returns {*}
   */
  middleware(req, res, next) {
    var matches, type, key;
    var self = this;

    // Check for special JS/CSS Versioned Path
    if ((matches = req.url.match(/\/(js|css)\/(\w{32})/i))) {
      // We have a match
      type = matches[1];
      key = matches[2];
    }

    if (!type && !key) {
      return next();
    }

    co(function *() {

      try {
        let file = yield Q.nfcall(self.getFile.bind(self), key, type);
        if (file) {
          self.sendHeaders(res, type, file);
          res.status(200).send(file);
        } else {
          res.status(404).send('Not Found');
        }
      } catch(e) {
        self.warn(e.message);
        res.status(404).send('Not Found');
      }
    }).catch(function(e) {
      self.error(e);
    });
  }

  /**
   * Send the headers for this file
   *
   * @param {Object} res
   * @param {String} type the file type
   * @param {String} file the minified file
   */
  sendHeaders(res, type, file) {
    res.header('Content-Type', 'text/' + type);
    res.header('Content-Length', Buffer.byteLength(file));
    res.header('Access-Control-Allow-Origin', '*');

    if (this.config.cache.maxAge > 0) {
      res.header('Expires', (new Date(Date.now() + this.config.cache.maxAge).toISOString()));
    }
  }

  /**
   * Get the client used for caching the files
   *
   * @throws {Error} Thrown when not using supported client
   * @returns {Object}
   */
  getClient() {
    if (typeof this.config.client === 'string') {
      if (typeof sand[this.config.client] === 'object') {
        // Fix for Riak
        if ('riak' == this.config.client) {
          if (!this.riak) {
            this.riak = new Riak(this.config);
          }

          return this.riak;
        }
        
        return sand[this.config.client];
      } else {
        throw new Error('Currently we only support SandGrains attached to sand.');
      }
    }

    throw new Error('Currently we only support SandGrains attached to sand.');
  }

  /**
   * Get the file from cache
   *
   * @param {String} key the file hash key
   * @param {String} type the file type
   * @param {Function} done
   */
  getFile(key, type, done) {
    let self = this;
    let client = this.getClient();

    client.get(key, function(err, file) {
      if (err) {
        self.error(err.message);
      }

      if (err || !file) {
        // Need to get original file

        client.get(key + '.files', function(err, fileString) {
          if (err || !fileString) {
            // Could not get the files
            return done(err);
          }

          co(function *() {
            let files = fileString.split(',');
            done(err, yield self.getMinifiedFile(type, files));
          }).catch(function(err) {
            done(err);
          });
        });

      } else {
        done(err, file);
      }
    })
  }

  /**
   * Get the Minified JS URL
   *
   * @param {Array} files
   * @returns {*}
   */
  minifiedJSURL(files) {
    return this.getMinifiedURL('js', files, 'js', 'js');
  }

  /**
   * Get the Minified CSS URL
   *
   * @param {Array} files
   * @returns {*}
   */
  minifiedCSSURL(files) {
    return this.getMinifiedURL('css', files, 'css', 'css');
  }

  /**
   * Get the minified file
   *
   * @param {String} type - the file type
   * @param {Array} files - files to minify
   * @param {String} prefix - the file prefix
   * @param {String} ext - the file extension
   * @returns {string}
   */
  getMinifiedURL(type, files, prefix, ext) {
    if ('string' === typeof files) {
      files = files.split(',');
    }

    var key = crypto.createHash('md5').update(this.getFileHashes(files, prefix, ext), 'utf8').digest('hex');

    // Check if the File is Cached
    this.isCached(key, function(err, isCached) {
      if (err || !isCached) {
        this.cacheFile(type, key, files);
      }
    }.bind(this));

    return '/' + type + '/' + key;
  }

  /**
   * Check if the file is already cached
   *
   * @param {String} key
   * @param {Function} cb
   */
  isCached(key, cb) {
    let client = this.getClient();

    client.get(key, function(err, data) {
      cb(err, !!data)
    })
  }

  /**
   * Cache the file
   *
   * @param {String} type - the file type
   * @param {String} key - the hash key
   * @param {String} files - files
   */
  cacheFile(type, key, files) {
    let self = this;
    let client = this.getClient();

    // Because it may take a bit to create this file, lets
    // save the list of files so that they can be built later
    client.save(key + '.files', files.join(','), _.noop);
    co(function *() {
      let minified = yield self.getMinifiedFile(type, files);


      if (!minified) {
        // Nothing to save
        return;
      }

      self.saveCache(key, minified);
    }).catch(function(e) {
      self.error(e);
    });
  }

  /**
   * Save the file to cache
   *
   * @param {String} key
   * @param {String} minifiedFile
   */
  saveCache(key, minifiedFile) {
    let client = this.getClient();
    let lockKey = `lock-${key}`;

    // Check if there is all ready a lock on this file
    client.get(lockKey, function(err, data) {
      if (err || data) {
        // there is already a lock, so lets leave
        return;
      }

      // create the lock
      client.save(lockKey, 1, function(err) {

        if (!err) {
          // save the file
          client.save(key, minifiedFile, function(err) {
            // delete the lock
            client.delete(lockKey, _.noop);
          });
        }
      })
    });
  }

  /**
   * Get the minified file
   *
   * @param {String} type
   * @param {Array} files
   * @returns {*}
   */
  *getMinifiedFile(type, files) {
    let normalized = this.normalizeFiles(type, files);

      switch (type) {
        case 'js':
          return yield this.minifyJS(normalized);
          break;

        case 'css':
          return yield this.minifyCSS(normalized);
          break;

        default:
          // Invalid type specified
          return Promise.reject();
      }
  }

  /**
   * Get the file hashes for the array of files
   *
   * @param {Array} files
   * @param {String} prefix - the file prefix
   * @param {String} ext - the file extension
   * @returns {string}
   */
  getFileHashes(files, prefix, ext) {
    var hashes = [];
    prefix = prefix ? '/' + prefix + '/' : '';
    ext = ext ? '.' + ext : '';

    _.each(files, function(file, index) {
      file = path.normalize(prefix + file + ext);
      files[index] = file;

      if (this.hm.hashMap[file]) {
        hashes.push(this.hm.hashMap[file]);
      }
    }, this);

    return hashes.join(',');
  }

  /**
   * Minify the File
   *
   * @param {String} type - the type of file
   * @param {Array} files
   * @returns {Promise}
   */
  *minifyType(type, files) {
    var self = this;
    return new Promise(function(resolve, reject) {
      co(function *() {
        try {
          var combined = yield self.combineFiles(files);
        } catch(e) {
          return reject(e);
        }

        if (self.config.minified[type].enabled && self.config.minified.enabled) {
          compressor.compress(combined, {
            type: type
          }, function (err, data) {
            if (err) {
              reject(err);
            } else {
              data = '/* ' + files.map(function(file) { return path.basename(file) }).join(', ') + " */\n" + data;
              resolve(data);
            }
          });

          return;
        }

        resolve(combined);
      });
    });
  }

  /**
   * Minify JS files
   *
   * @param {Array} files
   * @returns {*}
   */
  *minifyJS(files) {
    return yield this.minifyType('js', files);
  }

  /**
   * Minify CSS Files
   *
   * @param {Array} files
   * @returns {*}
   */
  *minifyCSS(files) {
    return yield this.minifyType('css', files);
  }

  /**
   * Normalize the file paths
   *
   * @param {String} type
   * @param {Array} files
   * @returns {Array}
   */
  normalizeFiles(type, files) {
    let self = this;
    let normalized = [];

    files.forEach(function(file) {
      let filePath = path.normalize(sand.appPath + '/' + self.config.path + '/');

      if (!((new RegExp(`^/?${type}/`)).test(file))) {
        filePath  += type + '/';
      }

      filePath += file;

      if (!((new RegExp(`\.${type}$`, 'ig')).test(file))) {
        filePath += '.' + type;
      }

      normalized.push(path.normalize(filePath));
    });

    return normalized;
  }

  /**
   * Combine the files into one
   *
   * @param {Array} files
   * @returns {Promise}
   */
  combineFiles(files) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var combined = '';

      async.eachSeries(files, function(file, cb) {
        fs.readFile(file, function(err, contents) {
          if (err) {
            return cb(err);
          }

          combined += contents + '\n';

          cb();
        });
      }, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(combined.trim());
        }
      });

    });

  }
}

module.exports = Static;