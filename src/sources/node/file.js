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

    this.paused = true;
  }

  getSize() {
    fs.stat(this.filename, (error, stat) => {
      if (error) {
        this.emit('error', error);
        return;
      }

      this.size = stat.size;
      this.start();
    });
  }

  start() {
    this.paused = false;
    if (this.size == null) {
      this.getSize();
      return;
    }

    if (this.stream) {
      this.stream.resume();
      return;
    }

    this.stream = fs.createReadStream(this.filename);

    this.stream.on('data', (buffer) => {
      this.loaded += buffer.length;
      this.emit('progress', (this.loaded / this.size) * 100);
      this.emit('data', new AVBuffer(new Uint8Array(buffer)));
    });

    this.stream.on('end', () => {
      this.emit('end');
    });

    this.stream.on('error', (error) => {
      this.pause();
      this.emit('error', error);
    });
  }

  pause() {
    this.stream.pause();
    this.paused = true;
  }
}
