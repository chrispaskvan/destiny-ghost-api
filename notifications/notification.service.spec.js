import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import mockTwilioCreateMessageResponse from '../mocks/twilioCreateMessageResponse.json';
import Notifications from './notification.service';

const client = {
    messages: {
        create: vi.fn(() => Promise.resolve(mockTwilioCreateMessageResponse)),
    },
};

let notificationService;

beforeEach(() => {
    notificationService = new Notifications({ client });
});

describe('Notifications', () => {
    it('sendMessage', async () => {
        const { sid, dateCreated, status } = await notificationService.sendMessage('Aegis of the Reef', '+11111111111');

        expect(sid).toEqual(mockTwilioCreateMessageResponse.sid);
        expect(dateCreated).toEqual(mockTwilioCreateMessageResponse.dateCreated);
        expect(status).toEqual(mockTwilioCreateMessageResponse.status);
    });
});
