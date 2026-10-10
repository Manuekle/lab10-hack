import {loadFont} from '@remotion/fonts';
import {staticFile} from 'remotion';
// loadFont blocks the render until these actual local faces have loaded.
void Promise.all([
  loadFont({family: 'Cooper', url: staticFile('fonts/CooperLtBT_400-latin.woff2'), weight: '400'}),
  loadFont({family: 'Cooper', url: staticFile('fonts/CooperLtBT_500-latin.woff2'), weight: '500'}),
  loadFont({family: 'SF Text', url: staticFile('fonts/SF-Pro-Text-Regular.otf'), weight: '400'}),
  loadFont({family: 'SF Text', url: staticFile('fonts/SF-Pro-Text-Medium.otf'), weight: '500'}),
  loadFont({family: 'SF Text', url: staticFile('fonts/SF-Pro-Text-Semibold.otf'), weight: '600'}),
]);
