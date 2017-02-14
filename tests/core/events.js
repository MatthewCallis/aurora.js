import test from 'ava';
import AVEventEmitter from './../../src/core/events';

test('on', (t) => {
  const emitter = new AVEventEmitter();
  let times = 0;

  emitter.on('test', (a, b) => {
    times++;
    t.is('a', a);
    t.is('b', b);
  });

  emitter.emit('test', 'a', 'b');
  emitter.emit('test', 'a', 'b');
  t.is(2, times);
});

test('off', (t) => {
  let times = 0;
  const fn = () => times++;
  const emitter = new AVEventEmitter();

  emitter.on('test', fn);

  emitter.emit('test');
  emitter.off('test', fn);
  emitter.emit('test');

  emitter.off('test-new', fn);

  t.is(1, times);
});

test('once', (t) => {
  const emitter = new AVEventEmitter();
  let times = 0;

  emitter.once('test', () => times++);

  emitter.emit('test');
  emitter.emit('test');
  emitter.emit('test');

  t.is(1, times);
});

test('emit', (t) => {
  const emitter = new AVEventEmitter();
  let times = 0;

  emitter.on('test', () => times++);
  emitter.on('test', () => times++);
  emitter.emit('test');

  t.is(2, times);
});
