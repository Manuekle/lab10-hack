import React from 'react';
import {Composition, Folder, Series, useVideoConfig} from 'remotion';
import {Intro} from './Intro';
import {Architecture} from './Architecture';
import {Demo} from './Demo';
import {Safety} from './Safety';
import {Incident} from './Incident';
import {Results} from './Results';
import {Closing} from './Closing';
export const FrontierDemo = () => {
  const {fps} = useVideoConfig();
  return <Series>
    <Series.Sequence name="La solicitud" durationInFrames={10 * fps} premountFor={fps}><Intro /></Series.Sequence>
    <Series.Sequence name="Una decisión por captura" durationInFrames={14 * fps} premountFor={fps}><Architecture /></Series.Sequence>
    <Series.Sequence name="E2 · grabación real" durationInFrames={32 * fps} premountFor={fps}><Demo /></Series.Sequence>
    <Series.Sequence name="El alcance de la tarea" durationInFrames={12 * fps} premountFor={fps}><Safety /></Series.Sequence>
    <Series.Sequence name="Incidente de las 15:30" durationInFrames={28 * fps} premountFor={fps}><Incident /></Series.Sequence>
    <Series.Sequence name="Resultados de práctica" durationInFrames={12 * fps} premountFor={fps}><Results /></Series.Sequence>
    <Series.Sequence name="Entrega" durationInFrames={8 * fps} premountFor={fps}><Closing /></Series.Sequence>
  </Series>;
};
export const RemotionRoot = () => <>
  <Composition id="FrontierDemo" component={FrontierDemo} width={1920} height={1080} fps={30} durationInFrames={3480} />
  <Folder name="Escenas">
    <Composition id="Intro" component={Intro} width={1920} height={1080} fps={30} durationInFrames={300} />
    <Composition id="Architecture" component={Architecture} width={1920} height={1080} fps={30} durationInFrames={420} />
    <Composition id="Demo" component={Demo} width={1920} height={1080} fps={30} durationInFrames={960} />
    <Composition id="Safety" component={Safety} width={1920} height={1080} fps={30} durationInFrames={360} />
    <Composition id="Incident" component={Incident} width={1920} height={1080} fps={30} durationInFrames={840} />
    <Composition id="Results" component={Results} width={1920} height={1080} fps={30} durationInFrames={360} />
    <Composition id="Closing" component={Closing} width={1920} height={1080} fps={30} durationInFrames={240} />
  </Folder>
</>;
