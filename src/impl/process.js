"use strict";

var dispatch = require("./dispatch");
var select = require("./select");
var channels = require("./channels");
var Channel = channels.Channel;
var buffers = require("./buffers");

var NO_VALUE = {};

var FnHandler = function(blockable, f) {
  this.f = f;
  this.blockable = blockable;
};

FnHandler.prototype.is_active = function() {
  return true;
};

FnHandler.prototype.is_blockable = function() {
  return this.blockable;
};

FnHandler.prototype.commit = function() {
  return this.f;
};

function put_then_callback(channel, value, callback) {
  var result = channel._put(value, new FnHandler(true, callback));
  if (result && callback) {
    callback(result.value);
  }
}

function take_then_callback(channel, callback) {
  var result = channel._take(new FnHandler(true, callback));
  if (result) {
    callback(result.value);
  }
}

var Process = function(gen, onFinish, creator) {
  this.gen = gen;
  this.creatorFunc = creator;
  this.finished = false;
  this.onFinish = onFinish;
  this.closeChannel = channels.chan(buffers.fixed(1));
};

var Instruction = function(op, data) {
  this.op = op;
  this.data = data;
};

var TAKE = "take";
var PUT = "put";
var ALTS = "alts";
var TAKE_OR_RETURN = "take_or_return";
var PREVENT_CLOSE = "prevent_close";

function ErrorResult(value) {
  this.value = value;
}

function ReturnResult(value) {
  this.value = value;
}

// TODO FIX XXX: This is a (probably) temporary hack to avoid blowing
// up the stack, but it means double queueing when the value is not
// immediately available
Process.prototype._continue = function(response) {
  var self = this;
  dispatch.run(function() {
    self.run(response);
  });
};

Process.prototype._done = function(value) {
  if (!this.finished) {
    this.finished = true;
    var onFinish = this.onFinish;
    if (typeof onFinish === "function") {
      dispatch.run(function() {
        onFinish(value);
      });
    }
  }
};

Process.prototype.close = function(value) {
  put_then_callback(this.closeChannel, new ReturnResult(value));
  this.closeChannel.close();
};

Process.prototype.run = function(response) {
  if (this.finished) {
    return;
  }

  // TODO: Shouldn't we (optionally) stop error propagation here (and
  // signal the error through a channel or something)? Otherwise the
  // uncaught exception will crash some runtimes (e.g. Node)
  var iter;
  if (response instanceof ErrorResult) {
    this.isClosing = true;
    iter = this.gen['throw'](response.value);
  } else if (response instanceof ReturnResult) {
    this.isClosing = true;
    iter = this.gen['return'](response.value);
  } else {
    iter = this.gen.next(response);
  }
  if (iter.done) {
    this._done(iter.value);
    return;
  }

  var ins = iter.value;
  var self = this;

  if (ins && typeof ins.then === 'function') {
    var promiseChannel = channels.chan();
    ins.then(function(value) {
      put_then_callback(promiseChannel, value);
    }, function(value) {
      put_then_callback(promiseChannel, new ErrorResult(value));
    });

    altsWithClose(this, [promiseChannel]);
  }
  else if (ins instanceof Instruction) {
    switch (ins.op) {
    case PUT:
      altsWithClose(this, [[ins.data.channel, ins.data.value]]);
      break;

    case TAKE:
      altsWithClose(this, [ins.data]);
      break;

    case TAKE_OR_RETURN:
      altsWithClose(this, [ins.data], null, function(altsResult) {
        var value = altsResult.value;
        return value === channels.CLOSED ? new ReturnResult(value) : value;
      });
      break;

    case ALTS:
      altsWithClose(this, ins.data.operations, ins.data.options, function(altsResult) {
        return altsResult;
      });
      break;

    case PREVENT_CLOSE:
      this.manualClose = true;
      this._continue(this.closeChannel);
      break;

    }
  }
  else if(ins instanceof Channel) {
    altsWithClose(this, [ins]);
  }
  else {
    this._continue(ins);
  }
};

function altsWithClose(process, _operations, options, mapper) {
  var operations = _operations.slice();

  if (!process.manualClose && !process.isClosing) {
    operations.unshift(process.closeChannel);
  }

  select.do_alts(operations, function(result) {
    if (result.channel === process.closeChannel) {
      process._continue(new ReturnResult(result));
    } else {
      process._continue(mapper ? mapper(result) : result.value);
    }
  }, options);
}

function take(channel) {
  return new Instruction(TAKE, channel);
}

function put(channel, value) {
  return new Instruction(PUT, {
    channel: channel,
    value: value
  });
}

function poll(channel) {
  if (channel.closed) {
    return NO_VALUE;
  }

  var result = channel._take(new FnHandler(false));
  if (result) {
    return result.value;
  } else {
    return NO_VALUE;
  }
}

function offer(channel, value) {
  if (channel.closed) {
    return false;
  }

  var result = channel._put(value, new FnHandler(false));
  if (result) {
    return true;
  } else {
    return false;
  }
}

function alts(operations, options) {
  return new Instruction(ALTS, {
    operations: operations,
    options: options
  });
}

function preventClose() {
  return new Instruction(PREVENT_CLOSE);
}

function takeOrReturn(chan) {
  return new Instruction(TAKE_OR_RETURN, chan);
}

exports.put_then_callback = put_then_callback;
exports.take_then_callback = take_then_callback;
exports.put = put;
exports.take = take;
exports.offer = offer;
exports.preventClose = preventClose;
exports.takeOrReturn = takeOrReturn;
exports.poll = poll;
exports.alts = alts;
exports.Instruction = Instruction;
exports.Process = Process;
exports.NO_VALUE = NO_VALUE;
