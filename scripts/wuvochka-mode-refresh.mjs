export function modeDetailsNeedRefresh(details, current) {
  return ['tower', 'wastes', 'dpm'].some((mode) =>
    !details?.[mode]?.label || details[mode].label !== current[mode].label,
  );
}
