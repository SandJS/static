"use strict";
const _ = require('lodash');

class MemcacheClient {
  constructor(config) {
    if (!sand.memcache) {
      throw new Error('Sand-Riak is required to be loaded first.');
    }

    this.client = sand.riak;
    this.config = config;
  }

  get(id, done) {
    this.client.get(id, function(err, value) {
      if ('object' === typeof value && _.isEmpty(value)) {
        value = null;
      }

      done(err, value);
    });
  }

  save(id, value, done) {
    this.client.set(id, value, this.config.cache.maxAge || 0, done);
  }

  delete(id, done) {
    this.client.del(id, done);
  }
}

module.exports = MemcacheClient;