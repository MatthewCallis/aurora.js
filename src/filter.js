export default class AVFilter {
  constructor(context, key) {
    // default constructor takes a single value
    // override to take more parameters
    if (context && key) {
      Object.defineProperty(this, 'value', {
        get() { return context[key]; },
      });
    }
  }

  // override this method
  process(buffer) {}
}
