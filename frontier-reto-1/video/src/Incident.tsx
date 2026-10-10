import React from 'react';
import {Video} from '@remotion/media';
import {CanvasImage, Easing, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {BasicCaptions} from './basic-captions';
import {Frame, palette, captionStyle, display} from './Frame';
export const Incident = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const phase = frame < 8 * fps ? 0 : frame < 19 * fps ? 1 : 2;
  const phaseStart = phase === 0 ? 0 : phase === 1 ? 8 * fps : 19 * fps;
  const settle = interpolate(frame - phaseStart, [0, .55 * fps], [24, 0], {easing: Easing.out(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <Frame chapter={phase === 2 ? 'SIGECOM 4.2 · observación real · 2×' : 'Incidente · ticket #FR-0153'} dark>
    {phase < 2 ? <>
      <div style={{position: 'absolute', left: 96, top: 192, width: 660, ...display, fontSize: phase === 0 ? 194 : 137, color: palette.yellow}}>{phase === 0 ? '15:30' : <>Guardar<br/>sin cerrar.</>}</div>
      <div style={{position: 'absolute', left: 106, top: 589, width: 590, fontSize: 37, lineHeight: 1.35}}>{phase === 0 ? <>SIGECOM 3.9 → 4.2<br/>Tema oficial confirmado.</> : <>La ficha abierta<br/>no indica un fallo.</>}</div>
      <div style={{position: 'absolute', left: 780, top: 172 + settle, width: 1060, height: 670, background: palette.white, color: palette.ink, clipPath: 'polygon(0 0, calc(100% - 48px) 0, 100% 48px, 100% 100%, 0 100%)', borderRadius: '10px 0 10px 10px', padding: '49px 50px', boxSizing: 'border-box'}}>
        <div style={{position: 'absolute', right: 0, top: 0, width: 48, height: 48, background: palette.line, clipPath: 'polygon(0 0, 0 100%, 100% 100%)'}} />
        {phase === 0 ? <>
          <div style={{fontSize: 26, fontWeight: 600, color: palette.cobalt}}>Captura del tema oficial · servidor del reto</div>
          <div style={{...display, fontSize: 75, marginTop: 27}}>Novedades 4.2.</div>
          <div style={{position: 'absolute', left: 30, top: 206, width: 1000, height: 426, overflow: 'hidden', borderRadius: 8, background: '#818993'}}>
            <CanvasImage src={staticFile('v42-modal-oficial.png')} premountFor={fps} style={{position: 'absolute', width: 2355.2, height: 1472, left: -680, top: -525}} />
          </div>
        </> : <>
          <div style={{fontSize: 26, fontWeight: 600, color: palette.cobalt}}>El cambio afecta la confirmación de una escritura</div>
          <div style={{...display, fontSize: 70, marginTop: 28}}>Aplicar sin cerrar.</div>
          <div style={{marginTop: 43, fontSize: 36, lineHeight: 1.4}}>
            <div style={{paddingBottom: 24, borderBottom: `2px solid ${palette.line}`}}>Campos aplicados, ficha aún abierta.</div>
            <div style={{padding: '24px 0', borderBottom: `2px solid ${palette.line}`}}>Leer la evidencia que confirma el guardado.</div>
            <div style={{paddingTop: 24}}>Verificar antes de repetir una escritura.</div>
          </div>
          <div style={{marginTop: 29, fontSize: 25, color: palette.muted}}>Controles por función · pistas antiguas descartadas</div>
        </>}
      </div>
    </> : null}
    <Sequence from={19 * fps} durationInFrames={9 * fps} name="Observación pasiva de SIGECOM 4.2" premountFor={fps}>
      <div style={{position: 'absolute', left: 64, top: 111, ...display, fontSize: 69}}>Tema nuevo. Pantalla real.</div>
      <div style={{position: 'absolute', left: 64, top: 213, width: 1792, height: 662, overflow: 'hidden', background: '#D9DEE7', borderRadius: 14}}>
        <Video name="Captura real v4.2 durante la prueba de conteo" src={staticFile('v42-observacion-real.mp4')} playbackRate={2} premountFor={fps} muted style={{position: 'absolute', left: 307.2, top: 0, width: 1177.6, height: 736, maxWidth: 'none'}} />
      </div>
    </Sequence>
    <BasicCaptions name="Subtítulos del incidente" premountFor={fps} width={1728} style={captionStyle} captions={[
      {"text":"El incidente ya está en el servidor: SIGECOM 4.2, con modal, botones nuevos y acciones a la derecha.","startMs":0,"endMs":8000,"timestampMs":null,"confidence":null,"pageBreakAfter":true},
      {"text":"Aplicar ya no cierra la ficha. El agente verifica el guardado antes de repetirlo.","startMs":8000,"endMs":13500,"timestampMs":null,"confidence":null,"pageBreakAfter":true},
      {"text":"Busca los controles por su función y descarta las pistas antiguas.","startMs":13500,"endMs":19000,"timestampMs":null,"confidence":null,"pageBreakAfter":true},
      {"text":"Esta captura muestra la ejecución en el tema oficial, durante la prueba de conteo.","startMs":19000,"endMs":24000,"timestampMs":null,"confidence":null,"pageBreakAfter":true},
      {"text":"La verificación incluye el estado de la app y el resumen de cada tarea.","startMs":24000,"endMs":28000,"timestampMs":null,"confidence":null,"pageBreakAfter":true}
    ]} />
  </Frame>;
};
