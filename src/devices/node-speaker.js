import Speaker from 'speaker';
import { Readable } from 'stream';

import AVEventEmitter from './../core/events';
import AVAudioDevice from './../device';

export default class NodeSpeakerDevice extends AVEventEmitter {
  constructor(sampleRate, channels) {
    super();

    this.refill = this.refill.bind(this);
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.speaker = new Speaker({
      channels: this.channels,
      sampleRate: this.sampleRate,
      bitDepth: 32,
      float: true,
      signed: true,
    });

    this.buffer = null;
    this.currentFrame = 0;
    this.ended = false;

    // setup a node readable stream and pipe to speaker output
    this.input = new Readable();
    this.input._read = this.refill;
    this.input.pipe(this.speaker);
  }

  refill(n) {
    const length = n / 4;
    const array = new Float32Array(length);

    this.emit('refill', array);
    if (this.ended) {
      return;
    }

    if (this.buffer && this.buffer.length !== n) {
      this.buffer = new Buffer(n);
    }

    // copy the data from the Float32Array into the node buffer
    let offset = 0;
    for (const frame of Array.from(array)) {
      this.buffer.writeFloatLE(frame, offset);
      offset += 4;
    }

    this.input.push(this.buffer);
    this.currentFrame += length / this.channels;
  }

  destroy() {
    this.ended = true;
    this.input.push(null);
  }

  getDeviceTime() {
    return this.currentFrame;
  }
}

AVAudioDevice.register(NodeSpeakerDevice);
