/**
 * Postmaster Model Tests
 */
import {
    describe, expect, it, vi, beforeEach,
} from 'vitest';
import Postmaster from './postmaster';
import users from '../mocks/users.json';
import { withRetry } from './retry.js';

vi.mock('./retry.js', () => ({
    withRetry: vi.fn(fn => fn()),
}));

// Mock nodemailer
vi.mock('nodemailer', () => ({
    createTransport: vi.fn(() => ({
        sendMail: vi.fn(options => Promise.resolve({
            accepted: [options.to],
            messageId: 'mock-message-id'
        }))
    }))
}));

const postmaster = new Postmaster();

describe('Postmaster delivery test', () => {
    const image = 'https://www.bungie.net/common/destiny_content/icons/ea293ac821ec38fa246199ad78732f22.png';
    const url = '/register';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('register method', () => {
        it('Should wrap sendMail with retry limited to connection errors', async () => {
            await postmaster.register(users[0], image, url);

            expect(withRetry).toHaveBeenCalledWith(
                expect.any(Function),
                { shouldRetry: expect.any(Function), maxRetries: 1 },
            );

            const { shouldRetry } = withRetry.mock.calls[0][1];

            expect(shouldRetry({ code: 'ECONNECTION' })).toBe(true);
            expect(shouldRetry({ code: 'ETIMEDOUT' })).toBe(true);
            expect(shouldRetry({ code: 'EAUTH' })).toBe(false);
            expect(shouldRetry({ code: 'ESOCKET' })).toBe(false);
        });

        it('Should return a message Id', async () => {
            const user = users[0];
            const response = await postmaster.register(user, image, url);

            expect(response.accepted[0]).toEqual(user.emailAddress);
        });

        it('Should handle missing image parameter', async () => {
            const user = users[0];
            const response = await postmaster.register(user, null, url);

            expect(response.accepted[0]).toEqual(user.emailAddress);
        });

        it('Should handle missing firstName', async () => {
            const user = { ...users[0], firstName: undefined };
            const response = await postmaster.register(user, image, url);

            expect(response.accepted[0]).toEqual(user.emailAddress);
        });

        it('Should generate correct email content for registration', async () => {
            const mockSendMail = vi.fn(() => Promise.resolve({
                accepted: [users[0].emailAddress],
            }));

            postmaster.transporter.sendMail = mockSendMail;

            await postmaster.register(users[0], image, url);

            const [mailOptions] = mockSendMail.mock.calls[0];

            expect(mailOptions.subject).toBe('Destiny Ghost Registration');
            expect(mailOptions.text).toContain('registration process');
            expect(mailOptions.html).toContain('registration process');
            expect(mailOptions.to).toBe(users[0].emailAddress);
        });

        it('Should include random color in HTML when image is provided', async () => {
            const mockSendMail = vi.fn(() => Promise.resolve({
                accepted: [users[0].emailAddress],
            }));

            postmaster.transporter.sendMail = mockSendMail;

            await postmaster.register(users[0], image, url);

            const [mailOptions] = mockSendMail.mock.calls[0];

            expect(mailOptions.html).toMatch(/background-color: #[0-9A-F]{6}/);
            expect(mailOptions.html).toContain(`<img src='${image}'`);
        });

        it('Should not include image tag when image is not provided', async () => {
            const mockSendMail = vi.fn(() => Promise.resolve({
                accepted: [users[0].emailAddress],
            }));
            
            postmaster.transporter.sendMail = mockSendMail;
            
            await postmaster.register(users[0], null, url);
            
            const [mailOptions] = mockSendMail.mock.calls[0];
            expect(mailOptions.html).not.toContain('<img src=');
        });
    });

    describe('confirm method', () => {
        it('Should send confirmation email successfully', async () => {
            const user = users[0];
            const response = await postmaster.confirm(user, image, url);
            expect(response.accepted[0]).toEqual(user.emailAddress);
        });

        it('Should generate correct email content for confirmation', async () => {
            const mockSendMail = vi.fn(() => Promise.resolve({
                accepted: [users[0].emailAddress],
            }));
            
            postmaster.transporter.sendMail = mockSendMail;
            
            await postmaster.confirm(users[0], image, url);
            
            const [mailOptions] = mockSendMail.mock.calls[0];

            expect(mailOptions.subject).toBe('Destiny Ghost Confirmation');
            expect(mailOptions.text).toContain('confirmation process');
            expect(mailOptions.html).toContain('confirmation process');
            expect(mailOptions.to).toBe(users[0].emailAddress);
        });

        it('Should handle missing image parameter', async () => {
            const user = users[0];
            const response = await postmaster.confirm(user, null, url);

            expect(response.accepted[0]).toEqual(user.emailAddress);
        });
    });

    describe('error handling', () => {
        it('Should handle email sending errors in register', async () => {
            const mockSendMail = vi.fn(() => Promise.reject(new Error('SMTP connection failed')));
            
            postmaster.transporter.sendMail = mockSendMail;
            
            await expect(postmaster.register(users[0], image, url))
                .rejects
                .toThrow('SMTP connection failed');
        });

        it('Should handle email sending errors in confirm', async () => {
            const mockSendMail = vi.fn(() => Promise.reject(new Error('Invalid recipient')));
            
            postmaster.transporter.sendMail = mockSendMail;
            
            await expect(postmaster.confirm(users[0], image, url))
                .rejects
                .toThrow('Invalid recipient');
        });
    });

    describe('email content validation', () => {
        it('Should include user token in email URL', async () => {
            const mockSendMail = vi.fn(() => Promise.resolve({
                accepted: [users[0].emailAddress],
            }));
            
            postmaster.transporter.sendMail = mockSendMail;
            
            await postmaster.register(users[0], image, url);
            
            const [mailOptions] = mockSendMail.mock.calls[0];
            const expectedToken = users[0].membership.tokens.blob;

            expect(mailOptions.text).toContain(`?token=${expectedToken}`);
            expect(mailOptions.html).toContain(`?token=${expectedToken}`);
        });

        it('Should include user firstName in email content', async () => {
            const mockSendMail = vi.fn(() => Promise.resolve({
                accepted: [users[0].emailAddress],
            }));
            
            postmaster.transporter.sendMail = mockSendMail;
            
            await postmaster.register(users[0], image, url);
            
            const [mailOptions] = mockSendMail.mock.calls[0];

            expect(mailOptions.text).toContain(`Hi ${users[0].firstName}`);
            expect(mailOptions.html).toContain(`Hi ${users[0].firstName}`);
        });

        it('Should set correct mail options properties', async () => {
            const mockSendMail = vi.fn(() => Promise.resolve({
                accepted: [users[0].emailAddress],
            }));
            
            postmaster.transporter.sendMail = mockSendMail;
            
            await postmaster.register(users[0], image, url);
            
            const [mailOptions] = mockSendMail.mock.calls[0];

            expect(mailOptions.from).toBeDefined();
            expect(mailOptions.tls.rejectUnauthorized).toBe(false);
            expect(mailOptions.to).toBe(users[0].emailAddress);
            expect(mailOptions.subject).toBeDefined();
            expect(mailOptions.text).toBeDefined();
            expect(mailOptions.html).toBeDefined();
        });
    });
});
