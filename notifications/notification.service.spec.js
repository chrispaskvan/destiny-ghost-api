const mockTwilioCreateMessageResponse = require('../mocks/twilioCreateMessageResponse'),
    expect = require('chai').expect;

const Notifications = require('./notification.service');

const twilioClient = {
    messages: {
        create: function (message, callback) {
            callback(null, mockTwilioCreateMessageResponse);
        }
    }
};

let notificationService;

beforeEach(function () {
    notificationService = new Notifications(twilioClient);
});

describe('Notifications', function () {
    it('sendMessage', function () {
        const { sid, dateCreated, status } = mockTwilioCreateMessageResponse;

        return notificationService.sendMessage('Aegis of the Reef', '+11111111111')
            .then(function (response) {
                expect(response).to.eql({ sid, dateCreated, status });
            });
    });
});
