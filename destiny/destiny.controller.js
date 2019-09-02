const _ = require('underscore'),
    base64url = require('base64url'),
    crypto = require('crypto');

/**
 * Controller class for Destiny routes.
 */
class DestinyController {
    /**
     * @constructor
     * @param options
     */
    constructor(options = {}) {
        this.destiny = options.destinyService;
        this.users = options.userService;
        this.world = options.worldRepository;
    }

    /**
     * Get a random state.
     *
     * @returns {*}
     * @private
     */
    static _getRandomState() {
        return base64url(crypto.randomBytes(11));
    }

    /**
     * Get the authorization URL for Bungie application.
     *
     * @param req
     * @param res
     */
    async getAuthorizationUrl(req, res) {
        const state = this.constructor._getRandomState();

        req.session.state = state;

        const url = await this.destiny.getAuthorizationUrl(state);

        res.send(url);
    }

    /**
     * Get characters for the current user.
     *
     * @returns {*|Array}
     * @private
     */
    async getCharacters(req, res) {
        const { session: { displayName, membershipType }} = req;
        const { membershipId } = await this.users.getUserByDisplayName(displayName, membershipType);
        const characters = await this.destiny.getCharacters(membershipId, membershipType);
        const characterBases = characters.map(character => {
            const { backgroundPath, characterBase = {}, emblem } = character;

            return {
                characterId: characterBase.characterId,
                classHash: characterBase.classHash,
                emblem,
                backgroundPath,
                powerLevel: characterBase.powerLevel,
                links: [
                    {
                        rel: 'Character',
                        href: '/characters/' + characterBase.characterId
                    }
                ]
            };
        });
        const characterClasses = await Promise.all(characterBases.map(characterBase =>
            this.world.getClassByHash(characterBase.classHash)));

        characterBases.forEach((characterBase, index) => {
            characterBase.className = characterClasses[index].className;
        });

        res.json(characterBases);
    }

    /**
     * Get the currently available field test weapons from the gun smith.
     *
     * @param req
     * @param res
     */
    async getFieldTestWeapons(req, res) {
        const { session: { displayName, membershipType }} = req;
        const { bungie: { access_token: accessToken }, membershipId } = await this.users.getUserByDisplayName(displayName, membershipType);
        const characters = await this.destiny.getCharacters(membershipId, membershipType);

        if (characters && characters.length > 0) {
            const { characterBase: { characterId }} = characters[0];
            const vendor = await this.destiny.getFieldTestWeapons(characterId, membershipType, accessToken);
            const { itemHashes } = vendor;
            const items = await Promise.all(
                itemHashes.map(itemHash => this.world.getItemByHash(itemHash))
            );

            res.json(items.map(item => item.itemName));
        }

        return res.status(411).end();
    }

    /**
     * Get the currently available foundry orders from the gun smith.
     *
     * @param req
     * @param res
     */
    async getFoundryOrders(req, res) {
        const { session: { displayName, membershipType }} = req;
        const { bungie: { access_token: accessToken }, membershipId } = await this.users.getUserByDisplayName(displayName, membershipType);
        const characters = await this.destiny.getCharacters(membershipId, membershipType);

        if (characters && characters.length > 0) {
            const { characterBase: { characterId }} = characters[0];
            const vendor = await this.destiny.getFoundryOrders(characterId, accessToken);
            const { itemHashes } = vendor;
            const items = await Promise.all(itemHashes.map(itemHash => this.world.getItemByHash(itemHash)));

            res.json(items.map(item => item.itemName));
        }

        return res.status(411).end();
    }

    /**
     * Get the currently available iron banner rewards from Lord Saladin.
     *
     * @param req
     * @param res
     */
    async getIronBannerEventRewards(req, res) {
        const { session: { displayName, membershipType }} = req;
        const { bungie: { access_token: accessToken }, membershipId } = await this.users.getUserByDisplayName(displayName, membershipType);
        const characters = await this.destiny.getCharacters(membershipId, membershipType);
        const characterItems = await Promise.all(characters.map(character => this.destiny.getIronBannerEventRewards(character.characterBase.characterId, membershipType, accessToken)));
        const rewards = _.flatten(characterItems);
        const itemHashes = _.uniq(rewards.map(({ item = {}}) => item.itemHash));
        const items = await Promise.all(itemHashes.map(itemHash => this.world.getItemByHash(itemHash)));
        const weapons = _.filter(items, item => _.contains(item.itemCategoryHashes, 1));
        const hunterArmor = _.filter(items, item => _.contains(item.itemCategoryHashes, 20) &&
            _.contains(item.itemCategoryHashes, 23));
        const titanArmor = _.filter(items, item => _.contains(item.itemCategoryHashes, 20) &&
            _.contains(item.itemCategoryHashes, 22));
        const warlockArmor = _.filter(items, item => _.contains(item.itemCategoryHashes, 20) &&
            _.contains(item.itemCategoryHashes, 21));

        res.json({
            weapons: _.map(weapons,item => item.itemName),
            armor: {
                hunter: _.map(hunterArmor, item => item.itemName),
                titan: _.map(titanArmor, item => item.itemName),
                warlock: _.map(warlockArmor, item => item.itemName)
            }
        });
    }

    /**
     * Get a random selection of Grimoire Cards.
     *
     * @param req
     * @param res
     * @returns {*}
     */
    async getGrimoireCards(req, res) {
        const numberOfCards = parseInt(req.params.numberOfCards, 10);

        if (isNaN(numberOfCards)) {
            return res.status(422).end();
        }

        const grimoireCards = await this.world.getGrimoireCards(numberOfCards);

        res.status(200).json(grimoireCards);
    }

    /**
     * Get the current manifest definition from Bungie.
     *
     * @param req
     * @param res
     */
    async getManifest(req, res) {
        const manifest = await this.destiny.getManifest()

        res.status(200).json(manifest);
    }

    /**
     * Get the exotic weapons and gear available from Xur.
     * @param req
     * @param res
     */
    async getXur(req, res) {
        const vendor = await this.destiny.getXur();
        const { itemHashes, nextRefreshDate } = vendor;

        if (itemHashes === undefined || itemHashes.length === 0) {
            return res.status(200).json({ itemHashes: [], nextRefreshDate: nextRefreshDate });
        }

        const allItems = await Promise.all(itemHashes.map(itemHash => this.world.getItemByHash(itemHash)));
        const itemPromises = _.map(allItems, item => {
            if (item.itemName === 'Exotic Engram' ||
                item.itemName === 'Legacy Engram') {
                return this.world.getItemByHash(item.itemHash)
                    .then(function (itemDetail) {
                        return item.itemName.replace('Engram', '') +
                            itemDetail.itemTypeName;
                    });
            }

            return Promise.resolve(item.itemName);
        });
        const items = await Promise.all(itemPromises);

        res.json(items);
    }

    /**
     * Insert or update the Destiny manifest.
     */
    async upsertManifest(req, res) {
        const manifest = await this.destiny.getManifest(true);
        await this.world.updateManifest(manifest);

        res.status(200).json(manifest);
    }
}

module.exports = DestinyController;
