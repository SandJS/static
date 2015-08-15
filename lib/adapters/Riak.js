"use strict";
const _ = require('lodash');

class RiakClient {
  constructor(options) {
    if (!sand.riak) {
      throw new Error('Sand-Riak is required to be loaded first.');
    }

    var riakConfig = options && options.riak ? options.riak : {};
    this.client = sand.riak;
    this.config = _.merge(this.client.config, riakConfig);
    sand.log(this.config);
  }

  get(id, done) {
    this.client.get(this.config.bucket, id, function(err, value) {
      if ('object' === typeof value && _.isEmpty(value)) {
        value = null;
      }

      done(err, value);
    });
  }

  save(id, value, done) {
    sand.log('saving', id, value);
    this.client.save(this.config.bucket, id, value, done);
  }

  delete(id, done) {
    this.client.delete(this.config.bucket, id, done);
  }
}

module.exports = RiakClient;