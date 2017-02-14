import WAVEDemuxer from './../../src/demuxers/wave';
import demuxerTest from './_demuxerTest';

demuxerTest('lei16', {
  file: 'wave/lei16.wav',
  format: {
    formatID: 'lpcm',
    sampleRate: 44100,
    bitsPerChannel: 16,
    channelsPerFrame: 2,
    bytesPerPacket: 4,
    framesPerPacket: 1,
    littleEndian: true,
    floatingPoint: false,
  },
  duration: 8916,
  data: '6b6b722b',
});

demuxerTest('lef32', {
  file: 'wave/lef32.wav',
  format: {
    formatID: 'lpcm',
    sampleRate: 44100,
    bitsPerChannel: 32,
    channelsPerFrame: 2,
    bytesPerPacket: 8,
    framesPerPacket: 1,
    littleEndian: true,
    floatingPoint: true,
  },
  duration: 8916,
  data: '9b2a9317',
});

demuxerTest('ulaw', {
  file: 'wave/ulaw.wav',
  format: {
    formatID: 'ulaw',
    sampleRate: 44100,
    bitsPerChannel: 8,
    channelsPerFrame: 2,
    bytesPerPacket: 2,
    framesPerPacket: 1,
    littleEndian: false,
    floatingPoint: false,
  },
  duration: 8916,
  data: '1af5b4fe',
});

demuxerTest('read the full fmt chunk', {
  file: 'wave/issue35.wav',
  format: {
    formatID: 'lpcm',
    sampleRate: 44100,
    bitsPerChannel: 16,
    channelsPerFrame: 2,
    bytesPerPacket: 4,
    framesPerPacket: 1,
    littleEndian: true,
    floatingPoint: false,
  },
  duration: 8916,
  data: '82d0f0ea',
});

demuxerTest('Invalid WAVE due to missing RIFF header', {
  file: 'au/bei16.au',
  demuxer: WAVEDemuxer,
  error: 'Invalid WAV file (No RIFF).',
});

demuxerTest('Invalid WAVE due to invalid file type header', {
  file: 'wave/ulaw_bad_wave_header.wav',
  demuxer: WAVEDemuxer,
  error: 'Invalid WAV file (No WAVE).',
});

demuxerTest('Invalid WAVE due to unsupported file format', {
  file: 'wave/ulaw unsupported_format.wav',
  demuxer: WAVEDemuxer,
  error: 'Unsupported format in WAV file. (8)',
});
