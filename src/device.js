//
// The AudioDevice class is responsible for interfacing with various audio
// APIs in browsers, and for keeping track of the current playback time
// based on the device hardware time and the play/pause/seek state
//

import AVEventEmitter from './core/events';

const devices = [];
export default class AVAudioDevice extends AVEventEmitter {
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
