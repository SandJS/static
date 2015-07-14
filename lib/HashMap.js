"use strict";

const co = require('co');
const Q = require('q');
const walker = require('walker');
const fs = require('fs');
const async = require('async');
const crypto = require('crypto');
const path = require('path');

class HashMap {
  constructor(path) {
    // trim trailing slash
    if (path && path.substring(path.length - 1) === '/') {
      path = path.slice(0, -1);
    }

    this.path = path;
    this.files = [];
    this.hashMap = Object.create(null);
    this.reverseMap = Object.create(null);
  }

  loadFiles(done) {
    var self = this;
    this.files = [];

    if (!fs.existsSync(this.path)) {
      throw new Error(this.path + ' directory does not exist');
    }

    // Walk through the files
    walker(this.path)
      .on('file', function(filename) {
        self.files.push(filename)
      })
      .on('end', function() {
        self.createHashMap(done);
      });
  }

  createHashMap(done) {
    var self = this;

    async.each(this.files, function(filename, fileCallback) {
      self.createHash(filename, function(error, fileHash) {
        // Return err callback as false, otherwise we get no files
        if (!fileHash) {
          return fileCallback(false);
        }

        // Normalize the path
        var urlPath = path.normalize('/' + filename.substring(self.path.length + 1)).replace(/\\/g, '/');

        self.hashMap[urlPath] = fileHash;
        self.reverseMap[fileHash] = urlPath;

        fileCallback(error)
      });
    }, function() {
      done();
    });
  }

  createHash(filename, done) {
    // Make sure the file exists
    if (!fs.existsSync(filename)) {
      return done(new Error(filename + ' does not exist'));
    }

    var md5sum = crypto.createHash('md5');
    var s = fs.ReadStream(filename);

    s.on('data', function(d) {
      md5sum.update(d)
    });

    s.on('end', function() {
      done(null, md5sum.digest('hex'))
    });
  }

  static createMap(path) {
    return new Promise(function(resolve, reject) {
      let hm = new HashMap(path);
      try {
        hm.loadFiles(function() {
          resolve(hm);
        });
      } catch(e) {
        reject(e);
      }
    });
  }
}

module.exports = HashMap;