import decoderTest from './_decoderTest';

decoderTest('i8', {
  file: 'm4a/i8.mov',
  data: 'f12b56ad',
});

decoderTest('lei16', {
  file: 'wave/lei16.wav',
  data: '6b6b722b',
});

decoderTest('bei16', {
  file: 'aiff/bei16.aiff',
  data: 'ca0bae1e',
});

decoderTest('bei24', {
  file: 'aiff/bei24.aiff',
  data: '689eecfa',
});

decoderTest('lei24', {
  file: 'wave/lei24.wav',
  data: '5a265e8a',
});

decoderTest('bef32', {
  file: 'au/bef32.au',
  data: '5cc026c5',
});

decoderTest('lef32', {
  file: 'wave/lef32.wav',
  data: '9b2a9317',
});

decoderTest('lei32', {
  file: 'wave/lei32.wav',
  data: '9826e28b',
});

decoderTest('lef64', {
  file: 'caf/lef64.caf',
  data: '9a3372e',
});

decoderTest('Unsupported bit depth (signed)', {
  file: 'wave/lei25_bad_bit_depth.wav',
  error: 'Unsupported bit depth. (25)',
});

decoderTest('Unsupported bit depth (floating point)', {
  file: 'wave/lef25_bad_bit_depth.wav',
  error: 'Unsupported bit depth. (25)',
});
