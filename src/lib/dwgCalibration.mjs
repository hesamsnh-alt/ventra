// Resolve only existing calibration evidence; never assume a DWG unit.
export function resolveDwgCalibration(takeoff={}) {
  const geometry =
    takeoff?.geometry ||
    {};

  const unitName = String(
    geometry?.unit ??
    takeoff?.model_unit ??
    takeoff?.advanced_takeoff?.model_unit ??
    ""
  ).trim().toLowerCase();

  const unitFactor = (() => {
    if (!unitName) return null;
    if (["m", "meter", "meters", "metre", "metres"].includes(unitName)) return 1;
    if (["mm", "millimeter", "millimeters", "millimetre", "millimetres"].includes(unitName)) return 0.001;
    if (["cm", "centimeter", "centimeters", "centimetre", "centimetres"].includes(unitName)) return 0.01;
    if (["ft", "foot", "feet"].includes(unitName)) return 0.3048;
    if (["in", "inch", "inches"].includes(unitName)) return 0.0254;
    return null;
  })();

  const ratioCandidate = (metricValue, modelValue) => {
    const metric = Number(metricValue);
    const model = Number(modelValue);
    if (!Number.isFinite(metric) || metric <= 0) return null;
    if (!Number.isFinite(model) || model <= 0) return null;
    const ratio = metric / model;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
  };

  const calibrationCandidate =
    Array.isArray(geometry?.unitCalibrationCandidates)
      ? geometry.unitCalibrationCandidates
          .map((item) => ({
            factor: Number(item?.factor),
            score: Number(item?.score),
          }))
          .filter((item) => Number.isFinite(item.factor) && item.factor > 0)
          .sort((a, b) => (Number.isFinite(b.score) ? b.score : -Infinity) - (Number.isFinite(a.score) ? a.score : -Infinity))[0]?.factor
      : null;

  const meterFactorEntries = [
    ["geometry.meterFactor", geometry?.meterFactor],
    ["geometry.sourceMeterFactor", geometry?.sourceMeterFactor],
    ["takeoff.meter_factor", takeoff?.meter_factor],
    ["takeoff.source_meter_factor", takeoff?.source_meter_factor],
    ["advanced_takeoff.meter_factor", takeoff?.advanced_takeoff?.meter_factor],
    ["advanced_takeoff.source_meter_factor", takeoff?.advanced_takeoff?.source_meter_factor],
    ["advanced_takeoff.geometry.meterFactor", takeoff?.advanced_takeoff?.geometry?.meterFactor],
    ["advanced_takeoff.geometry.sourceMeterFactor", takeoff?.advanced_takeoff?.geometry?.sourceMeterFactor],

    // Engineering-derived recovery paths. These use two measurements of the
    // same geometry, one already converted to metres and one in model units.
    ["geometry.totalLengthMeters/geometry.totalCurveLength",
      ratioCandidate(geometry?.totalLengthMeters, geometry?.totalCurveLength)],
    ["takeoff.total_curve_length_m/takeoff.total_curve_length",
      ratioCandidate(takeoff?.total_curve_length_m, takeoff?.total_curve_length)],
    ["takeoff.wall_length/geometry.wallLengthModelUnits",
      ratioCandidate(takeoff?.wall_length, geometry?.wallLengthModelUnits)],
    ["advanced_takeoff.wall_length/geometry.wallLengthModelUnits",
      ratioCandidate(takeoff?.advanced_takeoff?.wall_length, geometry?.wallLengthModelUnits)],

    ["geometry.unitCalibrationCandidates", calibrationCandidate],
    ["model unit", unitFactor],
  ];

  const resolvedMeterFactorEntry = meterFactorEntries
    .map(([source, value]) => [source, Number(value)])
    .find(([, value]) => Number.isFinite(value) && value > 0);

  const meterFactor = resolvedMeterFactorEntry?.[1] ?? null;

 return {geometry,meterFactor,unitName,source:resolvedMeterFactorEntry?.[0]||null};
}

export function dwgReconstructionReadiness(takeoff={}, expectedUrn='') {
 const c=resolveDwgCalibration(takeoff||{});
 const urn=takeoff?.aps_urn||takeoff?.apsUrn||takeoff?.urn||'';
 if(expectedUrn&&urn!==expectedUrn)return {...c,ready:false,reason:'The saved engineering geometry belongs to a different or missing Autodesk source.'};
 if(!Number.isFinite(c.meterFactor)||c.meterFactor<=0)return {...c,ready:false,reason:'DWG scale is not available yet. Complete geometry extraction/calibration in Drawings.'};
 const g=c.geometry;
 const walls=Array.isArray(g.wallLineSegments)?g.wallLineSegments:[];
 const ids=new Set((takeoff?.object_details?.walls||takeoff?.advanced_takeoff?.object_details?.walls||[]).map(w=>w.dbId).filter(id=>id!=null).map(String));
 const legacy=Array.isArray(g.lineSegments)&&g.lineSegments.some(l=>ids.has(String(l.dbId)));
 if(!walls.length&&!legacy)return {...c,ready:false,reason:'Verified wall geometry is not available yet. Complete geometry extraction in Drawings.'};
 return {...c,ready:true,reason:''};
}
