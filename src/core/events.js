export default class AVEventEmitter {
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
