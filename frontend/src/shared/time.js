export function formatCountdown(deadline, now = Date.now()) {
  if (!deadline) return '';
  const remainingSeconds = Math.max(0, Math.floor((Date.parse(deadline) - now) / 1000));
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  const clock = [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
  return days ? `${days} д. ${clock}` : clock;
}
