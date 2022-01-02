const mockTwilioCreateMessageResponse = require('../mocks/twilioCreateMessageResponse.json');

const Notifications = require('./notification.service');

const client = {
    messages: {
        create: (message, callback) => {
            callback(null, mockTwilioCreateMessageResponse);
        },
    },
};

let notificationService;

beforeEach(() => {
    notificationService = new Notifications({ client });
});

describe('Notifications', () => {
    it('sendMessage', () => {
        const { sid, dateCreated, status } = mockTwilioCreateMessageResponse;

        return notificationService.sendMessage('Aegis of the Reef', '+11111111111')
            .then(response => {
                expect(response).toEqual({ sid, dateCreated, status });
            });
    });
});
