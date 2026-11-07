// When to leave to arrive by a chosen time. Without live traffic, it's the least
// time the drive takes, not a promise.
export function leaveBy(now, hhmm, seconds) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  const arrive = new Date(now);
  arrive.setHours(+m[1], +m[2], 0, 0);
  // A time that has already gone today means tomorrow.
  if (arrive.getTime() <= now) arrive.setDate(arrive.getDate() + 1);
  const leave = new Date(arrive.getTime() - seconds * 1000);
  const late = leave.getTime() < now;
  return {
    arrive,
    leave,
    tomorrow: arrive.getDate() !== new Date(now).getDate(),
    late,
    lateBy: late ? (now - leave.getTime()) / 1000 : 0,
    arriveIfNow: new Date(now + seconds * 1000),
  };
}
