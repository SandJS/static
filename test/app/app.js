const sand = require('sand');
const http = require('sand-http');
const stat = require('../../lib/Static');

global.Controller = http.Controller;


var app = new sand({
  appPath: __dirname,
  log: '*'
});

app
  .use(stat)
  .use(http)
  .start();