function B = presupuesto_s2(S, W, R)
%PRESUPUESTO_S2 Per-pulse link budget for the target and the sea clutter.
%
%   B = presupuesto_s2(S, W, R)
%     S  struct from sistema_ref() with S.radar and S.env already set for the scenario
%     W  waveform: W.tau (s), W.B (Hz)
%     R  slant ranges (m), vector
%
%   Returns (per range):
%     B.snr1Db   single-pulse SNR after the matched filter, with F⁴ and atmosphere (dB)
%     B.FdB      one-way propagation factor (dB), exact two-ray
%     B.atmDb    two-way atmospheric loss (dB)
%     B.cnrDb    sea clutter / noise per pulse in the target cell (dB), without Doppler processing
%     B.grazDeg  grazing angle of the clutter cell (°)
%   and scalars B.Gt, B.Gr (dBi), B.hpbwAz (°), B.sigmaH (m), B.seaState.
%
%   Same model as the web app (environment.ts): aperture gains with taper
%   efficiency, pulse-limited cell with effective width θ3/1.33 (Barton) and
%   (ψ/ψc)⁴ roll-off below the critical angle ψc = λ/(4π·σh). σ⁰ from seareflectivity (NRL).

F = S.face; r = S.radar; e = S.env;
lam = F.lambda; c = S.c0;
Re = 4/3 * S.earthR;
N = F.Nx * F.Ny;
Pt = N * r.pElemW;

% gains: 4π·A/λ² (with cos θ = 1) and Taylor taper efficiency on receive
G0 = 10 * log10(4 * pi * N * F.d^2 / lam^2);
t = taylorwin(F.Nx, S.beam.nbar, -S.beam.sllDb);
etaT = (sum(t)^2 / (F.Nx * sum(t.^2)))^2;
B.Gt = G0; B.Gr = G0 + 10 * log10(etaT);
% −3 dB width of the tapered array factor (numerical, in the azimuth plane)
u = linspace(-0.1, 0.1, 40001);
af = abs(t.' * exp(1j * 2 * pi * F.d / lam * ((0:F.Nx - 1).' - (F.Nx - 1) / 2) * u)).^2;
af = af / max(af);
B.hpbwAz = 2 * asind(max(u(af >= 0.5)));

% sea state (Pierson-Moskowitz + swell)
hsW = 0.21 * e.windMs^2 / 9.80665;
Hs = hypot(hsW, e.swellHm);
lim = [0.0001 0.1 0.5 1.25 2.5 4 6 9 14];
B.seaState = min(9, sum(Hs > lim));
B.sigmaH = Hs / 4;

[~, ~, epsc] = earthSurfacePermittivity('sea-water', F.f0, e.seaTempC, 35);
Ts = S.T0 * 10^(r.nfDb / 10);
R = R(:).';
B.FdB = arrayfun(@(rr) 20 * log10(dos_rayos_exacto(rr, r.hRadarM, r.hTargetM, Re, lam, epsc, e.pol, B.sigmaH)), R);
rho = 216.7 * (e.rhPct / 100 * 6.1121 * exp(17.502 * e.tempC / (e.tempC + 240.97))) / (e.tempC + 273.15);
B.atmDb = 2 * gaspl(R, F.f0, e.tempC, e.pressHpa * 100, rho).';
snrFs = arrayfun(@(rr) radareqsnr(lam, rr, Pt, W.tau, 'Gain', [B.Gt B.Gr], 'RCS', r.rcsM2, 'Ts', Ts, 'Loss', r.lossDb), R);
B.snr1Db = snrFs + 4 * B.FdB - B.atmDb;

% sea clutter in the target cell
dR = c / (2 * W.B);
psi = asin(min(1, r.hRadarM ./ R - R / (2 * Re)));
psi(imag(psi) ~= 0 | psi <= 0) = 0;
B.grazDeg = psi * 180 / pi;
psiC = lam / (4 * pi * max(B.sigmaH, 0.01));
cnr = -Inf(size(R));
for i = 1:numel(R)
  if psi(i) <= 0, continue; end
  s0 = seareflectivity(B.seaState, max(0.1, B.grazDeg(i)), F.f0, 'Polarization', e.pol, 'Model', 'NRL');
  area = R(i) * (B.hpbwAz * pi / 180 / 1.33) * dR / cos(psi(i));   % effective two-way width θ3/1.33
  fc = min(1, (psi(i) / psiC)^4);
  cnr(i) = radareqsnr(lam, R(i), Pt, W.tau, 'Gain', [B.Gt B.Gr], 'RCS', s0 * area * fc, 'Ts', Ts, 'Loss', r.lossDb);
end
B.cnrDb = cnr;
end
