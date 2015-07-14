const sand = require('sand');
const http = require('sand-http');
const stat = require('../lib/Static');
const mockery = require('mockery');
const co = require('co');

var sandConfig = {
  appPath: __dirname + '/app',
  //log: '*'
};


describe('Static', function() {
  "use strict";

  global.Controller = http.Controller;
  var app;

  before(function(done) {
    mockery.enable({
      warnOnUnregistered: false
    });
    mockery.registerSubstitute('redis', 'redis-mock');

    app = (new sand(sandConfig))
      .use(stat)
      .use(http)
      .use(require('sand-redis'));

    // Need to make sure sand is correct
    global.sand = app;
    app.start(done);
  });

  it('should minify JS url', function() {
    global.sand.static.minifiedJSURL(['test']).should.eql('/js/22066a7d76f915520d5352cd17864f41');
  });

  it('should minify CSS url', function() {
    global.sand.static.minifiedCSSURL(['test']).should.eql('/css/11bcff4bc990625c396f8d8cabc48055');
  });

  describe('Minification', function() {
    it('should minify JS', function(done) {
      co(function *() {
        try {
          let minified = yield global.sand.static.getMinifiedFile('js', ['test']);
          minified.should.eql('function Test(){var a=this;this.doSomething=function(){return true}}Test.doSomethingElse=function(){return false};');
          done();
        } catch(e) {
          done(e);
        }
      });
    })

    it('should minify CSS', function(done) {
      co(function *() {
        try {
          let minified = yield global.sand.static.getMinifiedFile('css', ['test']);
          minified.should.eql('html,body{margin:0;padding:0;font-size:12px;color:#333}.test{font-size:20px}');
          done();
        } catch(e) {
          done(e);
        }
      });
    })
  });

  after(function(done) {
    mockery.deregisterAll();
    mockery.disable();
    app.shutdown(done);
  })
});