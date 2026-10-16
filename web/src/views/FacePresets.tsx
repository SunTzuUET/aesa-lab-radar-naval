// Predefined face sizes: from teaching examples to the full face.
import type { FaceConfig } from '../engine/config';
import { tr } from '../i18n';

export const PRESETS = (): { label: string; title: string; cfg: Pick<FaceConfig, 'nSubX' | 'nSubY' | 'subNx' | 'subNy'> }[] => [
  { label: '2×2', title: tr('4 elementos: el array más simple', '4 elements: the simplest array'), cfg: { nSubX: 2, nSubY: 2, subNx: 1, subNy: 1 } },
  { label: '4×4', title: tr('16 elementos', '16 elements'), cfg: { nSubX: 2, nSubY: 2, subNx: 2, subNy: 2 } },
  { label: '8×8', title: tr('un subarray: 64 elementos', 'one subarray: 64 elements'), cfg: { nSubX: 1, nSubY: 1, subNx: 8, subNy: 8 } },
  { label: '16×16', title: tr('4 subarrays de 8×8: 256 elementos', '4 subarrays of 8×8: 256 elements'), cfg: { nSubX: 2, nSubY: 2, subNx: 8, subNy: 8 } },
  { label: '40×40', title: tr('25 subarrays: 1600 elementos', '25 subarrays: 1600 elements'), cfg: { nSubX: 5, nSubY: 5, subNx: 8, subNy: 8 } },
  { label: tr('cara S', 'S face'), title: tr('cara completa: 100 subarrays, 6400 elementos', 'full face: 100 subarrays, 6400 elements'), cfg: { nSubX: 10, nSubY: 10, subNx: 8, subNy: 8 } },
];

export function FacePresets({ face, updFace }: { face: FaceConfig; updFace: (p: Partial<FaceConfig>) => void }) {
  return (
    <div className="ctl">
      <div className="ctl-head"><span>{tr('Tamaño', 'Size')}</span></div>
      <div className="seg presets">
        {PRESETS().map(pr => {
          const on = pr.cfg.nSubX === face.nSubX && pr.cfg.subNx === face.subNx && pr.cfg.nSubY === face.nSubY;
          return <button key={pr.label} title={pr.title} className={on ? 'on' : ''} onClick={() => updFace(pr.cfg)}>{pr.label}</button>;
        })}
      </div>
    </div>
  );
}
