import test from 'ava';
import path from 'path';
import AVBuffer from './../src/core/buffer';
import AVDemuxer from './../src/demuxer';
import AVDecoder from './../src/decoder';
import AVFileSource from './../src/sources/node/file';
import AVHTTPSource from './../src/sources/node/http';

import AIFFDemuxer from './../src/demuxers/aiff';
import AUDemuxer from './../src/demuxers/au';
import CAFDemuxer from './../src/demuxers/caf';
import M4ADemuxer from './../src/demuxers/m4a';
import WAVEDemuxer from './../src/demuxers/wave';

import LPCMDecoder from './../src/decoders/lpcm';
import XLAWDecoder from './../src/decoders/xlaw';

test('find', (t) => {
  t.falsy(AVDecoder.find());
  t.falsy(AVDecoder.find(''));
});

test.cb('decode error', (t) => {
  let source;
  if (process) {
    const file = path.resolve(__dirname, 'data/caf/lpcm.caf');
    source = new AVFileSource(file);
  } else {
    source = new AVHTTPSource('https://localhost:8181/data/caf/lpcm.caf');
  }

  source.once('data', (chunk) => {
    const Demuxer = AVDemuxer.find(chunk);
    const demuxer = new Demuxer(source, chunk);
    demuxer.once('format', (format) => {
      const Decoder = AVDecoder.find(format.formatID);
      const decoder = new Decoder(demuxer, format);

      decoder.readChunk = () => {
        throw Error('Fake Error');
      };

      decoder.on('error', (error) => {
        t.is(error.message, 'Fake Error');
        t.end();
      });

      function read() {
        while (decoder.decode()) {
          continue;
        }
        decoder.once('data', read);
      }

      read();
    });
  });

  source.start();
});
