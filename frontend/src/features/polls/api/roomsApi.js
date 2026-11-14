import { apiRequest } from '../../../shared/api/client.js';

export const listRooms = () => apiRequest('/api/rooms');
export const createRoom = data => apiRequest('/api/rooms', { method: 'POST', body: data });
export const getRoom = (roomId, inviteToken) => apiRequest(`/api/rooms/${encodeURIComponent(roomId)}${inviteToken ? `?invite_token=${encodeURIComponent(inviteToken)}` : ''}`);
export const joinRoom = (roomId, inviteToken) => apiRequest(`/api/rooms/${encodeURIComponent(roomId)}/join`, { method: 'POST', body: { invite_token: inviteToken } });
export const createRoomInvitation = roomId => apiRequest(`/api/rooms/${encodeURIComponent(roomId)}/invitation`, { method: 'POST', body: {} });
export const proposeRoomOption = (roomId, text) => apiRequest(`/api/rooms/${encodeURIComponent(roomId)}/proposals`, { method: 'POST', body: { text } });
export const decideRoomProposal = (roomId, proposalId, decision) => apiRequest(`/api/rooms/${encodeURIComponent(roomId)}/proposals/${encodeURIComponent(proposalId)}`, { method: 'PATCH', body: { decision } });
export const startRoomRound = roomId => apiRequest(`/api/rooms/${encodeURIComponent(roomId)}/rounds/start`, { method: 'POST', body: {} });
export const beginRoomRound = (roomId, roundId) => apiRequest(`/api/rooms/${encodeURIComponent(roomId)}/rounds/${encodeURIComponent(roundId)}/begin`, { method: 'POST', body: {} });
export const voteInRoomRound = (roomId, roundId, ballot) => apiRequest(`/api/rooms/${encodeURIComponent(roomId)}/rounds/${encodeURIComponent(roundId)}/votes`, { method: 'POST', body: ballot });
export const startNextRoomRound = roomId => apiRequest(`/api/rooms/${encodeURIComponent(roomId)}/rounds/new`, { method: 'POST', body: {} });
