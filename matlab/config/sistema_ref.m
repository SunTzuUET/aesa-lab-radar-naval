function S = sistema_ref()
%SISTEMA_REF Parameters of the generic S-band naval AESA radar (single source of truth).
%
%   S = sistema_ref() returns a struct with the default face, beam, radar and
%   environment. These are the same values as web/src/engine/config.ts and
%   web/src/engine/environment.ts (DEFAULT_FACE, DEFAULT_BEAM, DEFAULT_RADAR,
%   DEFAULT_ENV): if one changes, the other must change too.
%
%   Generic system with assumed parameters (see README).
%   All in SI units unless stated otherwise.

S.c0 = physconst('LightSpeed');
S.T0 = 290;
S.earthR = 6371000;

% --- face -------------------------------------------------------------------
S.face.f0      = 3.3e9;        % Hz
S.face.nSubX   = 10;           % horizontal subarrays
S.face.nSubY   = 10;
S.face.subNx   = 8;            % elements per subarray
S.face.subNy   = 8;
S.face.dLambda = 0.5;          % spacing in λ at f0
S.face.Nx      = S.face.nSubX * S.face.subNx;
S.face.Ny      = S.face.nSubY * S.face.subNy;
S.face.lambda  = S.c0 / S.face.f0;
S.face.d       = S.face.dLambda * S.face.lambda;
S.face.tiltDeg = 12;

% --- beam -------------------------------------------------------------------
S.beam.azDeg  = 0;
S.beam.elDeg  = 0;
S.beam.taper  = 'taylor';      % receive; transmit is uniform
S.beam.sllDb  = 35;
S.beam.nbar   = 5;
S.beam.psBits = 6;
S.beam.ttd    = true;

% --- radar ------------------------------------------------------------------
S.radar.pElemW  = 15;          % peak W per element
S.radar.tauS    = 100e-6;
S.radar.nPulses = 16;          % coherent integration
S.radar.nfDb    = 3;
S.radar.lossDb  = 6;
S.radar.rcsM2   = 1;
S.radar.pfa     = 1e-6;
S.radar.pdReq   = 0.9;
S.radar.hRadarM = 20;
S.radar.hTargetM = 5000;

% --- environment ------------------------------------------------------------
S.env.windMs      = 9;
S.env.windDirDeg  = 300;
S.env.swellHm     = 1.2;
S.env.swellTs     = 11;
S.env.swellDirDeg = 250;
S.env.tempC       = 18;
S.env.seaTempC    = 20;
S.env.rhPct       = 75;
S.env.pressHpa    = 1013;
S.env.rainMmH     = 0;
S.env.headingDeg  = 0;
S.env.speedKn     = 16;
S.env.finStab     = true;
S.env.beamStab    = true;
S.env.pol         = 'H';
S.env.bandwidthHz = 5e6;
S.env.cancelDb    = 35;
end
