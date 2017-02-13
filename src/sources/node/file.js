import fs from 'fs';
import AVEventEmitter from '../../core/events';
import AVBuffer from '../../core/buffer';

export default class AVFileSource extends AVEventEmitter {
  constructor(filename) {
    super();

    this.filename = filename;
    this.stream = null;
    this.loaded = 0;
    this.size = null;
  }

  getSize() {
    fs.stat(this.filename, (err, stat) => {
      if (err) {
        this.emit('error', err);
        return;
      }

      this.size = stat.size;
      this.start();
    });
  }

  start() {
    if (this.size == null) {
      this.getSize();
      return;
    }

    if (this.stream) {
      this.stream.resume();
      return;
    }

    this.stream = fs.createReadStream(this.filename);

    this.stream.on('data', (buf) => {
      this.loaded += buf.length;
      this.emit('progress', (this.loaded / this.size) * 100);
      this.emit('data', new AVBuffer(new Uint8Array(buf)));
    });

    this.stream.on('end', () => {
      this.emit('end');
    });

    this.stream.on('error', (err) => {
      this.pause();
      this.emit('error', err);
    });
  }

  pause() {
    return this.stream.pause();
  }
}
