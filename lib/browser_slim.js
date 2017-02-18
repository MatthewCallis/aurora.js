import http from 'http';
import fs from 'fs';

// define an error class to be thrown if an underflow occurs

class AVEventEmitter {
  on(event, fn) {
    if (this.events == null) { this.events = {}; }
    if (this.events[event] == null) { this.events[event] = []; }
    this.events[event].push(fn);
  }

  off(event, fn) {
    if (!this.events || !this.events[event]) {
      return;
    }

    const index = this.events[event].indexOf(fn);
    if (~index) {
      this.events[event].splice(index, 1);
    }
  }

  once(event, fn) {
    const cb = function cb(...args) {
      this.off(event, cb);
      fn.apply(this, args);
    };
    this.on(event, cb);
  }

  emit(event, ...args) {
    if (!this.events || !this.events[event]) {
      return;
    }

    // shallow clone with .slice() so that removing a handler while event is firing (as in once) doesn't cause errors
    for (const fn of this.events[event].slice()) {
      fn.apply(this, args);
    }
  }
}

//
// The AudioDevice class is responsible for interfacing with various audio
// APIs in browsers, and for keeping track of the current playback time
// based on the device hardware time and the play/pause/seek state
//

const devices = [];
class AVAudioDevice extends AVEventEmitter {
  constructor(sampleRate, channels) {
    super(sampleRate, channels);

    this.updateTime = this.updateTime.bind(this);
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.playing = false;
    this.currentTime = 0;
    this._lastTime = 0;
  }

  start() {
    if (this.playing) { return; }
    this.playing = true;

    if (this.device == null) { this.device = AVAudioDevice.create(this.sampleRate, this.channels); }
    if (!this.device) {
      throw new Error('No supported audio device found.');
    }

    this._lastTime = this.device.getDeviceTime();

    this._timer = setInterval(this.updateTime, 200);
    this.device.on('refill', this.refill = buffer => this.emit('refill', buffer)
    );
  }

  stop() {
    if (!this.playing) { return; }
    this.playing = false;

    this.device.off('refill', this.refill);
    clearInterval(this._timer);
  }

  destroy() {
    this.stop();
    if (this.device) {
      this.device.destroy();
    }
  }

  seek(currentTime) {
    this.currentTime = currentTime;
    if (this.playing) {
      this._lastTime = this.device.getDeviceTime();
    }
    this.emit('timeUpdate', this.currentTime);
  }

  updateTime() {
    const time = this.device.getDeviceTime();
    this.currentTime += (((time - this._lastTime) / this.device.sampleRate) * 1000) | 0;
    this._lastTime = time;
    this.emit('timeUpdate', this.currentTime);
  }

  static register(device) {
    return devices.push(device);
  }

  static create(sampleRate, channels) {
    for (const device of Array.from(devices)) {
      if (device.supported) {
        return new device(sampleRate, channels);
      }
    }

    return null;
  }
}

//
// The Asset class is responsible for managing all aspects of the
// decoding pipeline from source to decoder.  You can use the Asset
// class to inspect information about an audio file, such as its
// format, metadata, and duration, as well as actually decode the
// file to linear PCM raw audio data.
//

//
// The Player class plays back audio data from various sources
// as decoded by the Asset class.  In addition, it handles
// common audio filters like panning and volume adjustment,
// and interfacing with AudioDevices to keep track of the
// playback time.
//

// JavaScript Audio Resampler
// Copyright (C) 2011-2015 Grant Galitz
// Released to Public Domain
// Updated 2017 to ES6 - Matthew Callis

class Resampler {
  constructor(fromSampleRate, toSampleRate, channels, inputBuffer) {
    // Input Sample Rate:
    this.fromSampleRate = +fromSampleRate;
    // Output Sample Rate:
    this.toSampleRate = +toSampleRate;
    // Number of channels:
    this.channels = channels | 0;
    // Type checking the input buffer:
    if (typeof inputBuffer !== 'object') {
      throw (new Error('inputBuffer is not an object.'));
    }
    if (!(inputBuffer instanceof Array) && !(inputBuffer instanceof Float32Array) && !(inputBuffer instanceof Float64Array)) {
      throw (new Error('inputBuffer is not an array or a float32 or a float64 array.'));
    }
    this.inputBuffer = inputBuffer;

    // Initialize the resampler:
    this.initialize();
  }

  initialize() {
    // Perform some checks:
    if (this.fromSampleRate > 0 && this.toSampleRate > 0 && this.channels > 0) {
      if (this.fromSampleRate === this.toSampleRate) {
        // Setup a resampler bypass:
        this.resampler = this.bypassResampler; // Resampler just returns what was passed through.
        this.ratioWeight = 1;
        this.outputBuffer = this.inputBuffer;
      } else {
        this.ratioWeight = this.fromSampleRate / this.toSampleRate;
        if (this.fromSampleRate < this.toSampleRate) {
          /*
            Use generic linear interpolation if upsampling,
            as linear interpolation produces a gradient that we want
            and works fine with two input sample points per output in this case.
          */
          this.compileLinearInterpolationFunction();
          this.lastWeight = 1;
        } else {
          /*
            Custom resampler I wrote that doesn't skip samples
            like standard linear interpolation in high downsampling.
            This is more accurate than linear interpolation on downsampling.
          */
          this.compileMultiTapFunction();
          this.tailExists = false;
          this.lastWeight = 0;
        }
        this.initializeBuffers();
      }
    } else {
      throw (new Error('Invalid settings specified for the resampler.'));
    }
  }

  compileLinearInterpolationFunction() {
    let toCompile = `var outputOffset = 0;
      if (bufferLength > 0) {
          var buffer = this.inputBuffer;
          var weight = this.lastWeight;
          var firstWeight = 0;
          var secondWeight = 0;
          var sourceOffset = 0;
          var outputOffset = 0;
          var outputBuffer = this.outputBuffer;
          for (; weight < 1; weight += ${this.ratioWeight}) {
            secondWeight = weight % 1;
            firstWeight = 1 - secondWeight;`;

    for (let channel = 0; channel < this.channels; ++channel) {
      toCompile += `outputBuffer[outputOffset++] = (this.lastOutput[${channel}] * firstWeight) + (buffer[${channel}] * secondWeight);`;
    }

    toCompile += `}
      weight -= 1;
      for (bufferLength -= ${this.channels}, sourceOffset = Math.floor(weight) * ${this.channels}; sourceOffset < bufferLength;) {
          secondWeight = weight % 1;
          firstWeight = 1 - secondWeight;`;

    for (let channel = 0; channel < this.channels; ++channel) {
      toCompile += `outputBuffer[outputOffset++] = (buffer[sourceOffset${(channel > 0) ? (` + ${channel}`) : ''}] * firstWeight) + (buffer[sourceOffset + ${this.channels + channel}] * secondWeight);`;
    }
    toCompile += `weight += ${this.ratioWeight};
      sourceOffset = Math.floor(weight) * ${this.channels};
    }`;

    for (let channel = 0; channel < this.channels; ++channel) {
      toCompile += `this.lastOutput[${channel}] = buffer[sourceOffset++];`;
    }
    toCompile += `this.lastWeight = weight % 1;
      }
      return outputOffset;`;

    this.resampler = new Function('bufferLength', toCompile); // eslint-disable-line no-new-func
  }

  compileMultiTapFunction() {
    let toCompile = `var outputOffset = 0;
      if (bufferLength > 0) {
          var buffer = this.inputBuffer;
          var weight = 0;`;

    for (let channel = 0; channel < this.channels; ++channel) {
      toCompile += `var output${channel} = 0;`;
    }
    toCompile += `var actualPosition = 0;
      var amountToNext = 0;
      var alreadyProcessedTail = !this.tailExists;
      this.tailExists = false;
      var outputBuffer = this.outputBuffer;
      var currentPosition = 0;
      do {
          if (alreadyProcessedTail) {
              weight = ${this.ratioWeight};`;

    for (let channel = 0; channel < this.channels; ++channel) {
      toCompile += `output${channel} = 0;`;
    }
    toCompile += `}
          else {
              weight = this.lastWeight;`;

    for (let channel = 0; channel < this.channels; ++channel) {
      toCompile += `output${channel} = this.lastOutput[${channel}];`;
    }
    toCompile += `alreadyProcessedTail = true;
          }
          while (weight > 0 && actualPosition < bufferLength) {
              amountToNext = 1 + actualPosition - currentPosition;
              if (weight >= amountToNext) {`;

    for (let channel = 0; channel < this.channels; ++channel) {
      toCompile += `output${channel} += buffer[actualPosition++] * amountToNext;`;
    }
    toCompile += `currentPosition = actualPosition;
              weight -= amountToNext;
          }
          else {`;

    for (let channel = 0; channel < this.channels; ++channel) {
      toCompile += `output${channel} += buffer[actualPosition${(channel > 0) ? (` + ${channel}`) : ''}] * weight;`;
    }
    toCompile += `currentPosition += weight;
                  weight = 0;
                  break;
              }
          }
          if (weight <= 0) {`;

    for (let channel = 0; channel < this.channels; ++channel) {
      toCompile += `outputBuffer[outputOffset++] = output${channel} / ${this.ratioWeight};`;
    }
    toCompile += `}
          else {
              this.lastWeight = weight;`;

    for (let channel = 0; channel < this.channels; ++channel) {
      toCompile += `this.lastOutput[${channel}] = output${channel};`;
    }
    toCompile += `this.tailExists = true;
            break;
          }
        } while (actualPosition < bufferLength);
      }
      return outputOffset;`;

    this.resampler = new Function('bufferLength', toCompile); // eslint-disable-line no-new-func
  }

  bypassResampler(upTo) {
    return upTo;
  }

  initializeBuffers() {
    // Initialize the internal buffer:
    const outputBufferSize = (Math.ceil(this.inputBuffer.length * this.toSampleRate / this.fromSampleRate / this.channels * 1.000000476837158203125) * this.channels) + this.channels;
    try {
      this.outputBuffer = new Float32Array(outputBufferSize);
      this.lastOutput = new Float32Array(this.channels);
    } catch (error) {
      this.outputBuffer = [];
      this.lastOutput = [];
    }
  }
}

let sharedContext;
class WebAudioDevice extends AVEventEmitter {
  constructor(sampleRate, channels) {
    super();

    // Chrome limits the number of AudioContexts that one can create, so use a lazily created shared context for all playback.
    this.refill = this.refill.bind(this);
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.context = sharedContext != null ? sharedContext : (sharedContext = new AudioContext());
    this.deviceSampleRate = this.context.sampleRate;

    // calculate the buffer size to read
    this.bufferSize = Math.ceil((4096 / (this.deviceSampleRate / this.sampleRate)) * this.channels);
    this.bufferSize += this.bufferSize % this.channels;

    // if the sample rate doesn't match the hardware sample rate, create a resampler
    if (this.deviceSampleRate !== this.sampleRate) {
      this.resampler = new Resampler(this.sampleRate, this.deviceSampleRate, this.channels, 4096 * this.channels);
    }

    this.node = this.context.createScriptProcessor(4096, this.channels, this.channels);
    this.node.onaudioprocess = this.refill;
    this.node.connect(this.context.destination);
  }

  refill(event) {
    const { outputBuffer } = event;
    const channelCount = outputBuffer.numberOfChannels;
    const channels = new Array(channelCount);

        // get output channels
    for (let i = 0; i < channelCount; i++) {
      channels[i] = outputBuffer.getChannelData(i);
    }

        // get audio data
    let data = new Float32Array(this.bufferSize);
    this.emit('refill', data);

        // resample if necessary
    if (this.resampler) {
      data = this.resampler.resampler(data);
    }

        // write data to output
    for (let i = 0; i < outputBuffer.length; i++) {
      for (let n = 0; n < channelCount; n++) {
        channels[n][i] = data[(i * channelCount) + n];
      }
    }
  }

  destroy() {
    return this.node.disconnect(0);
  }

  getDeviceTime() {
    return this.context.currentTime * this.sampleRate;
  }
}

AVAudioDevice.register(WebAudioDevice);
