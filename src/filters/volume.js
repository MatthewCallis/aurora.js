import AVFilter from '../filter';

export default class AVVolumeFilter extends AVFilter {
  process(buffer) {
    if (this.value >= 100) {
      return;
    }
    const vol = Math.max(0, Math.min(100, this.value)) / 100;

    for (let i = 0, end = buffer.length; i < end; i++) {
      buffer[i] *= vol;
    }
  }
}
