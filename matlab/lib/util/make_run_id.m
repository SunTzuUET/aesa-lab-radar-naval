function runID = make_run_id()
%MAKE_RUN_ID Timestamp 'yyyyMMdd_HHmmss_mmm' (local time zone).
dt    = datetime('now', 'TimeZone','local');
ms    = mod(floor(milliseconds(dt - dateshift(dt,'start','second'))), 1000);
runID = sprintf('%s_%03d', char(dt,'yyyyMMdd_HHmmss'), ms);
end
