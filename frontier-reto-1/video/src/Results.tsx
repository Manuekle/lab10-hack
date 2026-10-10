import React from 'react';
import {useVideoConfig} from 'remotion';
import {BasicCaptions} from './basic-captions';
import {Frame, palette, captionStyle, display} from './Frame';
export const Results = () => {
  const {fps} = useVideoConfig();
  return <Frame chapter="Registro de verificación">
    <div style={{position: 'absolute', top: 166, left: 96, ...display, fontSize: 119}}>Lo que medimos.</div>
    <div style={{position: 'absolute', left: 102, top: 345, width: 1710}}>
      <div style={{display: 'flex', justifyContent: 'space-between', paddingBottom: 38, alignItems: 'center', borderBottom: `3px solid ${palette.cobalt}`}}>
        <div><div style={{fontSize: 51, fontWeight: 600}}>SIGECOM 3.9 · Railway</div><div style={{fontSize: 31, color: palette.muted, marginTop: 17}}>Dos rondas de práctica · antes del incidente</div><div style={{display: 'flex', gap: 18, marginTop: 27}}>{['E1', 'E2', 'E3', 'E4', 'E5'].map(label => <div key={label} style={{borderRadius: 8, background: palette.white, color: palette.cobalt, fontSize: 27, padding: '9px 18px'}}>{label} ✓✓</div>)}</div></div>
        <div style={{...display, fontSize: 146, color: palette.cobalt, marginRight: 13}}>10/10</div>
      </div>
      <div style={{display: 'flex', justifyContent: 'space-between', paddingTop: 37, alignItems: 'center'}}>
        <div><div style={{fontSize: 51, fontWeight: 600}}>SIGECOM 4.2 · tema oficial</div><div style={{fontSize: 31, color: palette.muted, marginTop: 17}}>E1–E5 desde reset · agente local · sin duplicados</div></div>
        <div style={{...display, fontSize: 146, color: palette.cobalt, marginRight: 13}}>5/5</div>
      </div>
    </div>
    <div style={{position: 'absolute', left: 104, top: 826, fontSize: 24, color: palette.muted}}>Fuentes: registro de ejecución + registro del incidente · 10 oct 2026</div>
    <BasicCaptions name="Subtítulos de resultados" premountFor={fps} width={1728} style={captionStyle} captions={[
      {"text":"La línea base en Railway fue diez de diez casos, en dos rondas completas.","startMs":0,"endMs":6000,"timestampMs":null,"confidence":null,"pageBreakAfter":true},
      {"text":"Tras el incidente: cinco de cinco casos sobre SIGECOM 4.2, en pruebas locales, sin duplicados.","startMs":6000,"endMs":12000,"timestampMs":null,"confidence":null,"pageBreakAfter":true}
    ]} />
  </Frame>;
};
