const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function isWithinWorkHours(date, { startHour, endHour, timeZone, workDays }) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === 'hour').value) % 24;
  const weekday = WEEKDAY_INDEX[parts.find((p) => p.type === 'weekday').value];

  return workDays.includes(weekday) && hour >= startHour && hour < endHour;
}

export { isWithinWorkHours };
