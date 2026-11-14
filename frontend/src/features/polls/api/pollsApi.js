import { apiRequest } from '../../../shared/api/client.js';

export const listPolls = () => apiRequest('/api/polls');
export const createPoll = data => apiRequest('/api/polls', { method: 'POST', body: data });
export const closePoll = pollId => apiRequest(`/api/polls/${encodeURIComponent(pollId)}/close`, { method: 'POST', body: {} });
export const submitRatings = (pollId, ratings) => apiRequest(`/api/polls/${encodeURIComponent(pollId)}/vote`, {
  method: 'POST',
  body: { ratings }
});
export const submitChoices = (pollId, optionIds) => apiRequest(`/api/polls/${encodeURIComponent(pollId)}/vote`, {
  method: 'POST',
  body: { option_ids: optionIds }
});
export const getPollDiscussion = pollId => apiRequest(`/api/polls/${encodeURIComponent(pollId)}/messages`);
export const sendPollMessage = (pollId, body) => apiRequest(`/api/polls/${encodeURIComponent(pollId)}/messages`, {
  method: 'POST',
  body: { body }
});
