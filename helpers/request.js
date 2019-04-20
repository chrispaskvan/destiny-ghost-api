const RequestError = require('../helpers/request.error'),
	axios = require('axios');

module.exports = {
	get: async (options) => {
		return request({
			method: 'get',
			...options
		});
	},
	post: async (options) => {
		return request({
			method: 'post',
			...options
		});
	}
};

async function request(options) {
	try {
		const { data: responseBody } = await axios(options);

		return responseBody;
	}
	catch (err) {
		throw new RequestError(err);
	}
}
