const mockTwilioCreateMessageResponse = require('../mocks/twilioCreateMessageResponse');

const Notifications = require('./notification.service');

const client = {
    messages: {
        create: function (message, callback) {
            callback(null, mockTwilioCreateMessageResponse);
        }
    }
};

let notificationService;

beforeEach(function () {
    notificationService = new Notifications({ client });
});

describe('Notifications', function () {
    it('sendMessage', function () {
        const { sid, dateCreated, status } = mockTwilioCreateMessageResponse;

        return notificationService.sendMessage('Aegis of the Reef', '+11111111111')
            .then(function (response) {
                expect(response).toEqual({ sid, dateCreated, status });
            });
    });
});
