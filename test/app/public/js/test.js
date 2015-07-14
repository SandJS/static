function Test() {
  "use strict";
  var self = this;

  this.doSomething = function() {
    return true;
  }
}

Test.doSomethingElse = function() {
  "use strict";
  return false;
};