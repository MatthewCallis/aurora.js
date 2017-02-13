import AVEventEmitter from '../core/events';
import AVBufferList from '../core/bufferlist';
import AVBuffer from '../core/buffer';

export default class AVBufferSource extends AVEventEmitter {
  constructor(input) {
    super();

    // Now make an AVBufferList
    this.loop = this.loop.bind(this);
    if (input instanceof AVBufferList) {
      this.list = input;
    } else {
      this.list = new AVBufferList();
      this.list.append(new AVBuffer(input));
    }

    this.paused = true;
  }

  start() {
    this.paused = false;
    this._timer = setImmediate(this.loop);
  }

  loop() {
    this.emit('progress', ((((this.list.numBuffers - this.list.availableBuffers) + 1) / this.list.numBuffers) * 100) | 0);
    this.emit('data', this.list.first);
    if (this.list.advance()) {
      return setImmediate(this.loop);
    }
    return this.emit('end');
  }

  pause() {
    clearImmediate(this._timer);
    this.paused = true;
  }

  reset() {
    this.pause();
    this.list.rewind();
  }
}
