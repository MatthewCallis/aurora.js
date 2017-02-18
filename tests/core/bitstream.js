import test from 'ava';
import AVStream from './../../src/core/stream';
import AVBuffer from './../../src/core/buffer';
import AVBitstream from './../../src/core/bitstream';

const makeBitstream = (bytes) => {
  const stream = AVStream.fromBuffer(new AVBuffer(new Uint8Array(bytes)));
  return new AVBitstream(stream);
};

test('copy', (t) => {
  const bitstream = makeBitstream([10, 160], [20, 29, 119]);
  const copy = bitstream.copy();

  t.not(copy, bitstream);
  t.deepEqual(copy, bitstream);
});

test('available', (t) => {
  const bitstream = makeBitstream([10, 160], [20, 29, 119]);
  let available = bitstream.available(1);

  t.true(available);

  available = bitstream.available(2);
  t.true(available);

  available = bitstream.available(32);
  t.false(available);
});

test('advance', (t) => {
  const bitstream = makeBitstream([10, 160]);

  t.is(0, bitstream.bitPosition);
  t.is(0, bitstream.offset());

  bitstream.advance(2);
  t.is(2, bitstream.bitPosition);
  t.is(2, bitstream.offset());

  bitstream.advance(7);
  t.is(1, bitstream.bitPosition);
  t.is(9, bitstream.offset());

  t.throws(() => bitstream.advance(40), Error);
});

test('rewind', (t) => {
  const bitstream = makeBitstream([10, 160]);

  t.is(0, bitstream.bitPosition);
  t.is(0, bitstream.offset());

  bitstream.advance(2);
  t.is(2, bitstream.bitPosition);
  t.is(2, bitstream.offset());

  bitstream.rewind(2);
  t.is(0, bitstream.bitPosition);
  t.is(0, bitstream.offset());

  bitstream.advance(10);
  t.is(2, bitstream.bitPosition);
  t.is(10, bitstream.offset());

  bitstream.rewind(4);
  t.is(6, bitstream.bitPosition);
  t.is(6, bitstream.offset());

  t.throws(() => bitstream.rewind(10), Error);
});

test('seek', (t) => {
  const bitstream = makeBitstream([10, 160]);

  t.is(0, bitstream.bitPosition);
  t.is(0, bitstream.offset());

  bitstream.seek(3);
  t.is(3, bitstream.bitPosition);
  t.is(3, bitstream.offset());

  bitstream.seek(10);
  t.is(2, bitstream.bitPosition);
  t.is(10, bitstream.offset());

  bitstream.seek(4);
  t.is(4, bitstream.bitPosition);
  t.is(4, bitstream.offset());

  t.throws(() => bitstream.seek(100), Error);

  t.throws(() => bitstream.seek(-10), Error);
});

test('align', (t) => {
  const bitstream = makeBitstream([10, 160]);

  t.is(0, bitstream.bitPosition);
  t.is(0, bitstream.offset());

  bitstream.align();
  t.is(0, bitstream.bitPosition);
  t.is(0, bitstream.offset());

  bitstream.seek(2);
  bitstream.align();
  t.is(0, bitstream.bitPosition);
  return t.is(8, bitstream.offset());
});

test('read/peek unsigned', (t) => {
  // 0101 1101 0110 1111 1010 1110 1100 1000 -> 0x5d6faec8
  // 0111 0000 1001 1010 0010 0101 1111 0011 -> 0x709a25f3
  let bitstream = makeBitstream([0x5d, 0x6f, 0xae, 0xc8, 0x70, 0x9a, 0x25, 0xf3]);

  t.is(0, bitstream.peek(0));
  t.is(0, bitstream.read(0));

  t.is(1, bitstream.peek(2));
  t.is(1, bitstream.read(2));

  t.is(7, bitstream.peek(4));
  t.is(7, bitstream.read(4));

  t.is(0x16f, bitstream.peek(10));
  t.is(0x16f, bitstream.read(10));

  t.is(0xaec8, bitstream.peek(16));
  t.is(0xaec8, bitstream.read(16));

  t.is(0x709a25f3, bitstream.peek(32));
  t.is(0x384d12f9, bitstream.peek(31));
  t.is(0x384d12f9, bitstream.read(31));

  t.is(1, bitstream.peek(1));
  t.is(1, bitstream.read(1));

  bitstream = makeBitstream([0x5d, 0x6f, 0xae, 0xc8, 0x70]);
  t.is(0x5d6faec870, bitstream.peek(40));
  t.is(0x5d6faec870, bitstream.read(40));

  bitstream = makeBitstream([0x5d, 0x6f, 0xae, 0xc8, 0x70]);
  t.is(1, bitstream.read(2));
  t.is(0xeb7d7643, bitstream.peek(33));
  t.is(0xeb7d7643, bitstream.read(33));

  bitstream = makeBitstream([0xff, 0xff, 0xff, 0xff, 0xff]);
  t.is(0xf, bitstream.peek(4));
  t.is(0xff, bitstream.peek(8));
  t.is(0xfff, bitstream.peek(12));
  t.is(0xffff, bitstream.peek(16));
  t.is(0xfffff, bitstream.peek(20));
  t.is(0xffffff, bitstream.peek(24));
  t.is(0xfffffff, bitstream.peek(28));
  t.is(0xffffffff, bitstream.peek(32));
  t.is(0xfffffffff, bitstream.peek(36));
  t.is(0xffffffffff, bitstream.peek(40));

  t.throws(() => bitstream.read(128), Error);
});

test('read/peek signed', (t) => {
  let bitstream = makeBitstream([0x5d, 0x6f, 0xae, 0xc8, 0x70, 0x9a, 0x25, 0xf3]);

  t.is(0, bitstream.peek(0));
  t.is(0, bitstream.read(0));

  t.is(5, bitstream.peek(4, true));
  t.is(5, bitstream.read(4, true));

  t.is(-3, bitstream.peek(4, true));
  t.is(-3, bitstream.read(4, true));

  t.is(6, bitstream.peek(4, true));
  t.is(6, bitstream.read(4, true));

  t.is(-1, bitstream.peek(4, true));
  t.is(-1, bitstream.read(4, true));

  t.is(-82, bitstream.peek(8, true));
  t.is(-82, bitstream.read(8, true));

  t.is(-889, bitstream.peek(12, true));
  t.is(-889, bitstream.read(12, true));

  t.is(9, bitstream.peek(8, true));
  t.is(9, bitstream.read(8, true));

  t.is(-191751, bitstream.peek(19, true));
  t.is(-191751, bitstream.read(19, true));

  t.is(-1, bitstream.peek(1, true));
  t.is(-1, bitstream.read(1, true));

  bitstream = makeBitstream([0x5d, 0x6f, 0xae, 0xc8, 0x70, 0x9a, 0x25, 0xf3]);
  bitstream.advance(1);

  t.is(-9278133113, bitstream.peek(35, true));
  t.is(-9278133113, bitstream.read(35, true));

  bitstream = makeBitstream([0xff, 0xff, 0xff, 0xff, 0xff]);
  t.is(-1, bitstream.peek(4, true));
  t.is(-1, bitstream.peek(8, true));
  t.is(-1, bitstream.peek(12, true));
  t.is(-1, bitstream.peek(16, true));
  t.is(-1, bitstream.peek(20, true));
  t.is(-1, bitstream.peek(24, true));
  t.is(-1, bitstream.peek(28, true));
  t.is(-1, bitstream.peek(31, true));
  t.is(-1, bitstream.peek(32, true));
  t.is(-1, bitstream.peek(36, true));
  t.is(-1, bitstream.peek(40, true));

  t.throws(() => bitstream.read(128), Error);
});

test('readLSB unsigned', (t) => {
  // {     byte 1     }{    byte 2  }
  // { 3   2      1   }{       3    }
  // { 1][111] [1100] }{ [0000 1000 } -> 0xfc08
  let bitstream = makeBitstream([0xfc, 0x08]);

  t.is(0, bitstream.peekLSB(0));
  t.is(0, bitstream.readLSB(0));

  t.is(12, bitstream.peekLSB(4));
  t.is(12, bitstream.readLSB(4));

  t.is(7, bitstream.peekLSB(3));
  t.is(7, bitstream.readLSB(3));

  t.is(0x11, bitstream.peekLSB(9));
  t.is(0x11, bitstream.readLSB(9));

  //      4            3           2           1
  // [0111 0000] [1001 1010] [0010 0101] 1[111 0011] -> 0x709a25f3
  bitstream = makeBitstream([0x70, 0x9a, 0x25, 0xf3]);
  t.is(0xf3259a70, bitstream.peekLSB(32));
  t.is(0x73259a70, bitstream.peekLSB(31));
  t.is(0x73259a70, bitstream.readLSB(31));

  t.is(1, bitstream.peekLSB(1));
  t.is(1, bitstream.readLSB(1));

  bitstream = makeBitstream([0xc8, 0x70, 0x9a, 0x25, 0xf3]);
  t.is(0xf3259a70c8, bitstream.peekLSB(40));
  t.is(0xf3259a70c8, bitstream.readLSB(40));

  bitstream = makeBitstream([0x70, 0x9a, 0x25, 0xff, 0xf3]);
  t.is(0xf3ff259a70, bitstream.peekLSB(40));
  t.is(0xf3ff259a70, bitstream.readLSB(40));

  bitstream = makeBitstream([0xff, 0xff, 0xff, 0xff, 0xff]);
  t.is(0xf, bitstream.peekLSB(4));
  t.is(0xff, bitstream.peekLSB(8));
  t.is(0xfff, bitstream.peekLSB(12));
  t.is(0xffff, bitstream.peekLSB(16));
  t.is(0xfffff, bitstream.peekLSB(20));
  t.is(0xffffff, bitstream.peekLSB(24));
  t.is(0xfffffff, bitstream.peekLSB(28));
  t.is(0xffffffff, bitstream.peekLSB(32));
  t.is(0xfffffffff, bitstream.peekLSB(36));
  t.is(0xffffffffff, bitstream.peekLSB(40));

  t.throws(() => bitstream.readLSB(128), Error);
});

test('readLSB signed', (t) => {
  let bitstream = makeBitstream([0xfc, 0x08]);

  t.is(0, bitstream.peekLSB(0));
  t.is(0, bitstream.readLSB(0));

  t.is(-4, bitstream.peekLSB(4, true));
  t.is(-4, bitstream.readLSB(4, true));

  t.is(-1, bitstream.peekLSB(3, true));
  t.is(-1, bitstream.readLSB(3, true));

  t.is(0x11, bitstream.peekLSB(9, true));
  t.is(0x11, bitstream.readLSB(9, true));

  bitstream = makeBitstream([0x70, 0x9a, 0x25, 0xf3]);
  t.is(-215639440, bitstream.peekLSB(32, true));
  t.is(-215639440, bitstream.peekLSB(31, true));
  t.is(-215639440, bitstream.readLSB(31, true));

  t.is(-1, bitstream.peekLSB(1, true));
  t.is(-1, bitstream.readLSB(1, true));

  bitstream = makeBitstream([0xc8, 0x70, 0x9a, 0x25, 0xf3]);
  t.is(-55203696440, bitstream.peekLSB(40, true));
  t.is(-55203696440, bitstream.readLSB(40, true));

  bitstream = makeBitstream([0x70, 0x9a, 0x25, 0xff, 0xf3]);
  t.is(-51553920400, bitstream.peekLSB(40, true));
  t.is(-51553920400, bitstream.readLSB(40, true));

  bitstream = makeBitstream([0xff, 0xff, 0xff, 0xff, 0xff]);
  t.is(-1, bitstream.peekLSB(4, true));
  t.is(-1, bitstream.peekLSB(8, true));
  t.is(-1, bitstream.peekLSB(12, true));
  t.is(-1, bitstream.peekLSB(16, true));
  t.is(-1, bitstream.peekLSB(20, true));
  t.is(-1, bitstream.peekLSB(24, true));
  t.is(-1, bitstream.peekLSB(28, true));
  t.is(-1, bitstream.peekLSB(31, true));
  t.is(-1, bitstream.peekLSB(32, true));
  t.is(-1, bitstream.peekLSB(36, true));
  t.is(-1, bitstream.peekLSB(40, true));

  t.throws(() => bitstream.readLSB(128), Error);
});
