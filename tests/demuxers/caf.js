import CAFDemuxer from './../../src/demuxers/caf';
import demuxerTest from './_demuxerTest';

demuxerTest('base', {
  file: 'caf/aac.caf',
  format: {
    formatID: 'aac ',
    sampleRate: 44100,
    bitsPerChannel: 0,
    channelsPerFrame: 2,
    bytesPerPacket: 0,
    framesPerPacket: 1024,
  },
  duration: 38659,
  data: 'd21b23ee',
});

demuxerTest('bei16', {
  file: 'caf/bei16.caf',
  format: {
    formatID: 'lpcm',
    sampleRate: 44100,
    bitsPerChannel: 16,
    channelsPerFrame: 2,
    bytesPerPacket: 4,
    framesPerPacket: 1,
    floatingPoint: false,
    littleEndian: false,
  },
  duration: 38659,
  data: '4f427df9',
});

demuxerTest('lei32', {
  file: 'caf/lei32.caf',
  format: {
    formatID: 'lpcm',
    sampleRate: 44100,
    bitsPerChannel: 32,
    channelsPerFrame: 2,
    bytesPerPacket: 8,
    framesPerPacket: 1,
    floatingPoint: false,
    littleEndian: true,
  },
  duration: 38659,
  data: '771d822a',
});

demuxerTest('bef32', {
  file: 'caf/bef32.caf',
  format: {
    formatID: 'lpcm',
    sampleRate: 44100,
    bitsPerChannel: 32,
    channelsPerFrame: 2,
    bytesPerPacket: 8,
    framesPerPacket: 1,
    floatingPoint: true,
    littleEndian: false,
  },
  duration: 38659,
  data: '7bf9d9d2',
});

demuxerTest('lef64', {
  file: 'caf/lef64.caf',
  format: {
    formatID: 'lpcm',
    sampleRate: 44100,
    bitsPerChannel: 64,
    channelsPerFrame: 2,
    bytesPerPacket: 16,
    framesPerPacket: 1,
    floatingPoint: true,
    littleEndian: true,
  },
  duration: 38659,
  data: '9a3372e',
});

demuxerTest('lpcm', {
  file: 'caf/lpcm.caf',
  format: {
    formatID: 'lpcm',
    sampleRate: 11025,
    bitsPerChannel: 8,
    channelsPerFrame: 2,
    bytesPerPacket: 2,
    framesPerPacket: 1,
    floatingPoint: false,
    littleEndian: false,
  },
  duration: 3234,
  data: '43baf1ef',
});

demuxerTest('cookie', {
  file: 'caf/aac_not_aac.caf',
  demuxer: CAFDemuxer,
  cookie: 'AVBuffer',
});

demuxerTest('Invalid CAF due to missing CAFF header', {
  file: 'caf/aac_bad_header_no_caff.caf',
  demuxer: CAFDemuxer,
  error: "Invalid CAF, does not begin with 'caff'",
});

demuxerTest('Invalid CAF due to missing desc header', {
  file: 'caf/aac_bad_header_no_desc.caf',
  demuxer: CAFDemuxer,
  error: "Invalid CAF, 'caff' is not followed by 'desc'",
});

demuxerTest('Invalid CAF due to invalid desc', {
  file: 'caf/aac_bad_header_bad_desc.caf',
  demuxer: CAFDemuxer,
  error: "Invalid 'desc' size, should be 32",
});

demuxerTest('Unsupported CAF due to oversized file', {
  file: 'caf/aac_oversized.caf',
  demuxer: CAFDemuxer,
  error: 'Holy Shit, an oversized file, not supported in JS',
});

demuxerTest('Unsupported CAF due to oversized pakt 1', {
  file: 'caf/aac_oversized_pakt_a.caf',
  demuxer: CAFDemuxer,
  error: 'Sizes greater than 32 bits are not supported.',
});

demuxerTest('Unsupported CAF due to oversized pakt 2', {
  file: 'caf/aac_oversized_pakt_b.caf',
  demuxer: CAFDemuxer,
  error: 'Sizes greater than 32 bits are not supported.',
});
