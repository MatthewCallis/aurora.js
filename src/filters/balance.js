import AVFilter from '../filter';

export default class AVBalanceFilter extends AVFilter {
  process(buffer) {
    if (this.value === 0) {
      return;
    }
    const pan = Math.max(-50, Math.min(50, this.value));

    for (let i = 0, end = buffer.length; i < end; i += 2) {
      buffer[i] *= Math.min(1, (50 - pan) / 50);
      buffer[i + 1] *= Math.min(1, (50 + pan) / 50);
    }
  }
}
