import AVAudioDevice from '../device';
import AVEventEmitter from '../core/events';
import Resampler from './resampler';

let sharedContext;
export default class WebAudioDevice extends AVEventEmitter {
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
