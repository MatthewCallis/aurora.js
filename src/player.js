//
// The Player class plays back audio data from various sources
// as decoded by the Asset class.  In addition, it handles
// common audio filters like panning and volume adjustment,
// and interfacing with AudioDevices to keep track of the
// playback time.
//
import AVEventEmitter from './core/events';
import AVAsset from './asset';
import AVVolumeFilter from './filters/volume';
import AVBalanceFilter from './filters/balance';
import AVQueue from './queue';
import AVAudioDevice from './device';

export default class AVPlayer extends AVEventEmitter {
  constructor(asset) {
    super();

    this.startPlaying = this.startPlaying.bind(this);
    this.asset = asset;
    this.playing = false;
    this.buffered = 0;
    this.currentTime = 0;
    this.duration = 0;
    this.volume = 100;
    this.pan = 0; // -50 for left, 50 for right, 0 for center
    this.metadata = {};

    this.filters = [
      new AVVolumeFilter(this, 'volume'),
      new AVBalanceFilter(this, 'pan'),
    ];

    this.asset.on('buffer', (buffered) => {
      this.buffered = buffered;
      return this.emit('buffer', this.buffered);
    }
        );

    this.asset.on('decodeStart', () => {
      this.queue = new AVQueue(this.asset);
      return this.queue.once('ready', this.startPlaying);
    }
        );

    this.asset.on('format', (format) => {
      this.format = format;
      return this.emit('format', this.format);
    }
        );

    this.asset.on('metadata', (metadata) => {
      this.metadata = metadata;
      return this.emit('metadata', this.metadata);
    }
        );

    this.asset.on('duration', (duration) => {
      this.duration = duration;
      return this.emit('duration', this.duration);
    }
        );

    this.asset.on('error', error => this.emit('error', error)
        );
  }

  static fromURL(url) {
    return new AVPlayer(AVAsset.fromURL(url));
  }

  static fromFile(file) {
    return new AVPlayer(AVAsset.fromFile(file));
  }

  static fromBuffer(buffer) {
    return new AVPlayer(AVAsset.fromBuffer(buffer));
  }

  preload() {
    if (!this.asset) {
      return;
    }

    this.startedPreloading = true;
    this.asset.start(false);
  }

  play() {
    if (this.playing) { return; }

    if (!this.startedPreloading) {
      this.preload();
    }

    this.playing = true;
    if (this.device) {
      this.device.start();
    }
  }

  pause() {
    if (!this.playing) { return; }

    this.playing = false;
    if (this.device) {
      this.device.stop();
    }
  }

  togglePlayback() {
    if (this.playing) {
      return this.pause();
    }
    return this.play();
  }

  stop() {
    this.pause();
    this.asset.stop();
    if (this.device) {
      this.device.destroy();
    }
  }

  seek(timestamp) {
    if (this.device) {
      this.device.stop();
    }
    this.queue.once('ready', () => {
      if (this.device) {
        this.device.seek(this.currentTime);
      }
      if (this.playing) {
        if (this.device) {
          this.device.start();
        }
      }
    });

    // convert timestamp to sample number
    timestamp = (timestamp / 1000) * this.format.sampleRate;

    // the actual timestamp we seeked to may differ from the requested timestamp due to optimizations
    timestamp = this.asset.decoder.seek(timestamp);

    // convert back from samples to milliseconds
    this.currentTime = ((timestamp / this.format.sampleRate) * 1000) | 0;

    this.queue.reset();
    return this.currentTime;
  }

  startPlaying() {
    let frame = this.queue.read();
    let frameOffset = 0;

    this.device = new AVAudioDevice(this.format.sampleRate, this.format.channelsPerFrame);
    this.device.on('timeUpdate', (currentTime) => {
      this.currentTime = currentTime;
      return this.emit('progress', this.currentTime);
    }
        );

    this.refill = (buffer) => {
      if (!this.playing) { return; }

            // try reading another frame if one isn't already available
            // happens when we play to the end and then seek back
      if (!frame) {
        frame = this.queue.read();
        frameOffset = 0;
      }

      let bufferOffset = 0;
      while (frame && (bufferOffset < buffer.length)) {
        const max = Math.min(frame.length - frameOffset, buffer.length - bufferOffset);
        for (let i = 0, end = max; i < end; i++) {
          buffer[bufferOffset++] = frame[frameOffset++];
        }

        if (frameOffset === frame.length) {
          frame = this.queue.read();
          frameOffset = 0;
        }
      }

            // run any applied filters
      for (const filter of Array.from(this.filters)) {
        filter.process(buffer);
      }

            // if we've run out of data, pause the player
      if (!frame) {
                // if this was the end of the track, make
                // sure the currentTime reflects that
        if (this.queue.ended) {
          this.currentTime = this.duration;
          this.emit('progress', this.currentTime);
          this.emit('end');
          this.stop();
        } else {
                    // if we ran out of data in the middle of
                    // the track, stop the timer but don't change
                    // the playback state
          this.device.stop();
        }
      }
    };

    this.device.on('refill', this.refill);
    if (this.playing) { this.device.start(); }
    return this.emit('ready');
  }
}
