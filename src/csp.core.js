"use strict";

var buffers = require("./impl/buffers");
var channels = require("./impl/channels");
var select = require("./impl/select");
var process = require("./impl/process");
var timers = require("./impl/timers");
var dispatch = require("./impl/dispatch");

function spawn(gen, creator) {
  var ch = channels.chan(buffers.fixed(1));
  var proc = (new process.Process(gen, function(value) {
    if (value === channels.CLOSED) {
      ch.close();
    } else {
      process.put_then_callback(ch, value, function(ok) {
        ch.close();
      });
    }
  }, creator));

  // FIXME: better way to expose process?
  ch.process = proc;
  proc.run();
  return ch;
};

function go(f, args) {
  args = args || [];

  var gen = f.apply(null, args);
  return spawn(gen, f);
};

function chan(bufferOrNumber, xform, exHandler) {
  var buf;
  if (bufferOrNumber === 0) {
    bufferOrNumber = null;
  }
  if (typeof bufferOrNumber === "number") {
    buf = buffers.fixed(bufferOrNumber);
  } else {
    buf = bufferOrNumber;
  }
  return channels.chan(buf, xform, exHandler);
};


module.exports = {
  buffers: {
    fixed: buffers.fixed,
    dropping: buffers.dropping,
    sliding: buffers.sliding
  },

  spawn: spawn,
  go: go,
  chan: chan,
  DEFAULT: select.DEFAULT,
  CLOSED: channels.CLOSED,

  put: process.put,
  take: process.take,
  offer: process.offer,
  poll: process.poll,
  alts: process.alts,
  putAsync: process.put_then_callback,
  takeAsync: process.take_then_callback,
  preventClose: process.preventClose,
  takeOrReturn: process.takeOrReturn,
  NO_VALUE: process.NO_VALUE,

  timeout: timers.timeout,

  set_queue_dispatcher: dispatch.set_queue_dispatcher,
  set_queue_delayer: dispatch.set_queue_delayer
};
