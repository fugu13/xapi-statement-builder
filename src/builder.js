import { Record, Map, List, fromJS } from 'immutable';
import uuidv1 from 'uuid/v1';

import { uriOracle, CompositeOracle, ProfileOracle } from './oracle';

/**
 * @typedef {string} uri
 */
/**
 * @typedef {string} uuid
 */
/**
 * @typedef {Object} LanguageMap
 */
/**
 * @typedef {{id: string, description: LanguageMap}} InteractionComponent
 */
/**
 * @typedef {{id: uri, display: LanguageMap}} Verb
 */


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function capitalize(s) {
    return s[0].toUpperCase() + s.slice(1);
}

function adapt(concept) { // concept must be immutable Map
    switch(concept.type) {
        case 'Activity':
            const definition = concept.activityDefinition.delete('@concept');
            return {
                id: concept.id,
                objectType: 'Activity',
                definition
            };
        case 'Verb':
            return {
                id: concept.id,
                display: concept.prefLabel
            };
        default:
            // these will only use the id, in this case
            return concept;
    }
}

const _BuilderRecord = Record({
    map: Map(),
    instanceIdentifier: null,  // contract: must be UUID
    oracle: new CompositeOracle().add(uriOracle)
});


class BuilderRecord extends _BuilderRecord {
    static builder(value) {
        const record = new this().set('instanceIdentifier', uuidv1());
        if(value instanceof BuilderRecord) {
            // already a real one, just return it
            return value;
        } else if(value) {
            return record.merge({
                map: value
            });
        } else {
            return record;
        }
    }

    validate(js) {
        // TODO: implement this in Statements
        // there doesn't seem to be a good JS xAPI validation library out there.
        // make pluggable?
        return;
    }

    prebuild() {
        return this;
    }


    build() {
        const js = this.prebuild().map.toJS();
        // console.log("Built!", js);
        this.validate(js);
        return js;
    }

    lookup(identifier, objectType) {
        const found = this.oracle.lookup(identifier, objectType);
        if(found) {
            return adapt(found);
        } else {
            throw new Error("No " + objectType + " found for: '" + identifier + "'");
        }
    }
}



export class AgentBuilder extends BuilderRecord {

    /**
    * Use `builder` to create instances of AgentBuilder.
    *
    * @example <caption>create an Agent with an mbox.</caption>
    * let builder = AgentBuilder.builder();
    * builder = builder.withEmail("nandita@example.gov");
    * console.log(builder.build());
    * @param {?Object} value A plain javascript Agent or Group.
    * @return {AgentBuilder} A builder for xAPI Agents and Groups.
    */
    static builder(value) {
        return super.builder(value).updateIn(['map', 'objectType'],
            (v) => v || "Agent");
    }

    /**
    * Add an `mbox` based on an email
    *
    * @param {string} email Email to use for the Agent/Group `mbox` property
    * @return {AgentBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withEmail(email) {
        return this.withMbox('mailto:' + email);
    }

    /**
    * Add a personal or descriptive name for this Agent or Group
    *
    * @param {string} name Name to use for the Agent/Group `name` property.
    * @return {AgentBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withName(name) {
        return this.setIn(['map', 'name'], name);
    }

    /**
    * Add the `homePage` URL of an `account`
    *
    * @param {uri} homePage URL to use for the Agent/Group `account`
    * `homePage` property
    * @return {AgentBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withHomePage(homePage) {
        return this.set('map', this.map.withMutations(map => {
            map.delete('account');
            map.setIn(['account', 'homePage'], homePage);
        }));
    }

    /**
    * Add the `name` identifier of an `account`. This is a unique identifier
    * the system identified by `homePage` links to a particular account.
    *
    * @param {string} name Name to use for the Agent/Group `account` `name`
    * property.
    * @return {AgentBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withAccountName(name) {
        return this.setIn(['map', "account", "name"], name);
    }

    /**
    * Makes this create a Group (AgentBuilder makes Agents by default).
    *
    * @return {AgentBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    asGroup() {
        return this.setIn(['map', 'objectType'], 'Group');
    }

    /**
    * Adds an Agent as a `member`. Makes this a Group if it isn't already.
    * @param {Object} agent Another AgentBuilder or a plain Javascript object
    * representing a complete Agent, to add to the `member` property.
    * @return {AgentBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withMember(agent) {
        const _agent = AgentBuilder.builder(agent);
        return this.asGroup().updateIn(['map', 'member'],
            (members = List()) => members.push(_agent.map));
    }

    /**
    * @ignore
    */
    withIdentifier(ifi, value) {
        return this.set('map', this.map.withMutations((map) => {
            map.delete('mbox');
            map.delete('mbox_sha1sum');
            map.delete('openid');
            map.delete('account');

            map.set(ifi, fromJS(value));
        }));
    }

    /**
    * Identify this with an `mbox` (must start with `mailto:`!)
    * @param {uri} mbox What to set the `mbox` to.
    * @return {AgentBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withMbox(mbox) {
        return this.withIdentifier('mbox', mbox);
    }

    /**
    * Identify this with an `mbox_sha1sum`
    * @param {string} sha1 What to set the `mbox_sha1sum` to.
    * @return {AgentBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withMbox_sha1sum(sha1) {
        return this.withIdentifier('mbox_sha1sum', sha1);
    }

    /**
    * Identify this with an `openid`
    * @param {uri} openid URI to set the `openid` to.
    * @return {AgentBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withOpenid(openid) {
        return this.withIdentifier('openid', openid);
    }

    /**
    * Identify this with an `account`
    * @param {{homePage: uri, name: string}} account object to set `account`
    * to.
    * @return {AgentBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withAccount(account) {
        return this.withIdentifier('account', account);
    }

}


export class ActivityBuilder extends BuilderRecord {

    /**
    * Use `builder` to create instances of ActivityBuilder.
    * @param {?Object} value A plain javascript Activity.
    * @return {ActivityBuilder} A builder for xAPI Activities.
    */
    static builder(value) {
        if(typeof value === 'string') {
            value = this.lookup(value, 'Activity');
        }
        return super.builder(value).setIn(['map', 'objectType'], "Activity");
    }

    /**
    * Set the Activity `id`
    *
    * If the `id` is not a URI but matches a name of an Activity in a Profile
    * loaded by {@link StatementBuilder#withProfile}, the `id` of that Activity will
    * be used. Throws an error if the `id` does not match a name and is not
    * uri-like.
    * @param {uri|string} id URI to set the `id` to or name of an Activity from
    * a Profile.
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withId(id) {
        // TODO decide if this should overwrite whole dang object...
        // No! create an extra method, something like
        // asProfile() or enrich()!
        const activity = this.lookup(id, 'Activity');
        return this.setIn(['map', 'id'], activity.id);
    }

    /**
    * Set the Activity `type`
    *
    * If the `type` is not a URI but matches a name of an Activity Type in a
    * Profile loaded by {@link StatementBuilder#withProfile}, the uri of that
    * Activity Type will be used. Throws an error if the `type` does not match
    * a name and is not uri-like.
    * @param {uri|string} type URI to set the `type` to.
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withType(type) {
        const activityType = this.lookup(type, 'ActivityType');
        return this.setIn(['map', 'definition', 'type'], activityType.id);
    }

    /**
    * Add an extension to the Activity definition
    *
    * If the `key` is not a URI but matches a name of an Activity Extension in a
    * Profile loaded by {@link StatementBuilder#withProfile}, the uri of that
    * Activity Extension will be used. Throws an error if the `key` does not
    * match a name and is not uri-like.
    * @param {uri|string} key URI key of the extension
    * @param {*} value any JSON-legal data structure
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withExtension(key, value) {
        const extension = this.lookup(key, 'ActivityExtension')
        return this.setIn(['map', 'definition', 'extensions', extension.id], fromJS(value));
    }

    /**
    * @ignore
    */
    withKey(key, value) {
        return this.setIn(['map', 'definition', key], fromJS(value));
    }

    /**
    * Add a `moreInfo` URL
    *
    * @param {uri} url URL to use for `moreInfo`.
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withMoreInfo(url) {
        return this.withKey('moreInfo', uri);
    }

    /**
    * Add an `interactionType`
    *
    * @param {string} value `interactionType` to use.
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withInteractionType(value) {
        return this.withKey('interactionType', value);
    }

    /**
    * Add possible `correctResponsesPattern` values
    *
    * @param {string[]} responses strings indicating possible
    * `correctResponsesPattern` values
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withCorrectResponsesPattern(responses) {
        return this.withKey('correctResponsesPattern', responses);
    }

    /**
    * Add available `choices` for this interaction
    *
    * @param {InteractionComponent[]} choices interaction components with string `id`
    * and language map `description`
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withChoices(choices) {
        return this.withKey('choices', choices);
    }

    /**
    * Add `scale` values for this interaction
    *
    * @param {InteractionComponent[]} scale interaction components with string `id`
    * and language map `description`
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withScale(scale) {
        return this.withKey('scale', scale);
    }

    /**
    * Add available `source` values for this interaction
    *
    * @param {InteractionComponent[]} source interaction components with string `id`
    * and language map `description`
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withSource(source) {
        return this.withKey('source', source);
    }

    /**
    * Add available `target` values for this interaction
    *
    * @param {InteractionComponent[]} target interaction components with string `id`
    * and language map `description`
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withTarget(target) {
        return this.withKey('target', target);
    }

    /**
    * Add available `steps` for this interaction
    *
    * @param {InteractionComponent[]} steps interaction components with string `id`
    * and language map `description`
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withSteps(steps) {
        return this.withKey('steps', steps);
    }

    /**
    * @ignore
    */
    withLanguageMap(key, language, value) {
        return this.updateIn(['map', 'definition', key],
            (languages = Map()) => languages.set(language, value));
    }

    /**
    * Add a `name` for this Activity in a particular `language`
    *
    * @param {string} name the name of this Activity in that language.
    * @param {string} language an RFC 5646 language tag, such as `en` or
    * `zh-Hans`.
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withName(name, language) {
        return this.withLanguageMap('name', language, name);
    }

    /**
    * Add a `definition` for this activity in a particular `language`
    *
    * @param {string} definition the definition of this Activity in that
    * language.
    * @param {string} language an RFC 5646 language tag, such as `en` or
    * `zh-Hans`.
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withDefinition(definition, language) {
        return this.withLanguageMap('definition', language, definition);
    }
}



export class AttachmentBuilder extends BuilderRecord {

    /**
    * Provide a `usageType` uri
    *
    * If the `uri` is not a URI but matches a name of an Attachment Usage Type
    * in a Profile loaded by {@link StatementBuilder#withProfile}, the uri of
    * that Attachment Usage Type will be used. Throws an error if the `uri`
    * does not match a name and is not uri-like.
    * @param {uri|string} uri the attachment usage type
    * @return {AttachmentBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withUsageType(uri) {
        const usageType = this.lookup(uri, 'AttachmentUsageType');
        return this.setIn(['map', 'usageType'], usageType.id);
    }

    /**
    * @ignore
    */
    withKey(key, value) {
        return this.setIn(['map', key], value);
    }

    /**
    * Provide a `contentType` for the attachment, also called a media type or
    * MIME type
    *
    * @param {string} contentType the attachment content type
    * @return {AttachmentBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withContentType(contentType) {
        return this.withKey('contentType', contentType);
    }

    /**
    * Provide a `length` for the attachment in octets
    *
    * @param {integer} length the attachment length in octets
    * @return {AttachmentBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withLength(length) {
        return this.withKey('length', length);
    }

    /**
    * Provide a `sha2` for the attachment
    *
    * This is the hexadecimal value of a hash from the SHA-2 family of hashes,
    * with a bit-length of 224, 256, 384, or 512.
    * @param {string} sha2 the attachment SHA-2 hash in hex
    * @return {AttachmentBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withSha2(sha2) {
        return this.withKey('sha2', sha2);
    }

    /**
    * Provide a `fileUrl` where this attachment can be accessed
    *
    * The fileUrl does not need to public, but should be as accessible as
    * possible.
    * @param {uri} fileUrl a URL to retrieve the attachment from.
    * @return {AttachmentBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withFileUrl(fileUrl) {
        return this.withKey('fileUrl', fileUrl);
    }

    /**
    * @ignore
    */
    withLanguageMap(key, language, value) {
        return this.updateIn(['map', key],
            (languages = Map()) => languages.set(language, value));
    }

    /**
    * Add a `display` for this attachment in a particular `language`
    *
    * @param {string} display a short display value for this Attachment in that
    * language.
    * @param {string} language an RFC 5646 language tag, such as `en` or
    * `zh-Hans`.
    * @return {AttachmentBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withDisplay(display, language) {
        return this.withLanguageMap('name', language, display);
    }

    /**
    * Add a `description` for this attachment in a particular `language`
    *
    * @param {string} description a description for this Attachment in that
    * language.
    * @param {string} language an RFC 5646 language tag, such as `en` or
    * `zh-Hans`.
    * @return {AttachmentBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withDescription(description, language) {
        return this.withLanguageMap('name', language, description);
    }
}



export class StatementBuilder extends BuilderRecord {
    /**
    * @ignore
    */
    withOracle(oracle) {
        return this.updateIn(['oracle'], (main) => main.add(oracle));
    }

    /**
    * Add an xAPI Profile to enable referring to terms by name instead of URI
    * with later API calls.
    *
    * @param {Object} profile a complete xAPI Profile as a JSON object.
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withProfile(profile) {
        return this.withOracle(ProfileOracle.fromProfile(profile));
    }

    /**
    * Add the `verb` for the Statement
    *
    * If the `verb` is not a verb object or a URI but matches a name of a Verb
    * in a Profile loaded by {@link StatementBuilder#withProfile}, the complete
    * Profile representation of that verb will be used. Throws an error if the
    * `verb` does not match a name and is not uri-like or an object with an
    * `id`. If a URI is provided will also attempt to load the complete
    * Profile representation.
    * @param {uri|string|Verb} verb the verb URI, name or object.
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withVerb(verb) {
        const fullVerb = verb.id ? verb : this.lookup(verb, 'Verb');
        return this.setIn(['map', 'verb'], fromJS(fullVerb));
    }

    /**
    * Add the `verb` `display` for a particular `language`
    *
    * @param {string} language an RFC 5646 language tag, such as `en` or
    * `zh-Hans`.
    * @param {string} display a short display value for the verb in that
    * language.
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withVerbDisplay(language, display) {
        return this.updateIn(['map', 'verb', 'display'],
            (languages = Map()) => languages.set(language, display));
    }

    /**
    * Add the `object` for the Statement
    *
    * There are several possible ways to provide the `object`:
    *   * As the UUID `id` of a Statement. The `object` will be set to a
    * StatementRef with that `id`.
    *   * As a name or URI of an Activity. If the Activity is found in a
    * Profile loaded by {@link StatementBuilder#withProfile}, the complete
    * Profile representation of that Activity will be used. Throws an error
    * if a name does not match an Activity and is not uri-like.
    *   * As a builder from this library for an Agent, Group, or Activity.
    *   * As a {@link StatementBuilder}, which will be used as a SubStatement
    * according to the rules from the xAPI specification.
    *   * as a complete simple javascript object of an Activity, Agent, Group,
    * StatementRef, or SubStatement.
    * @param
    * {uuid|uri|string|StatementBuilder|AgentBuilder|ActivityBuilder|Object}
    * object the `object` to use
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withObject(object) {
        const path = ['map', 'object'];
        if(UUID_RE.test(object)) {
            return this.setIn(path, fromJS({
                objectType: 'StatementRef',
                id: object
            }));
        } else if(typeof object === 'string') {
            const activity = this.lookup(object, 'Activity');
            return this.setIn(path, fromJS(activity));
        } else if(object instanceof BuilderRecord) {
            // TODO add check and conversion to SubStatement!
            return this.setIn(path, object.map);
        } else {
            return this.setIn(path, fromJS(object));
        }
    }

    /**
    * Add an attachment to the Statement
    *
    * @param {Attachment} attachment an AttachmentBuilder or simple javascript
    * object of an attachment.
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withAttachment(attachment) {
        const full_attachment = AttachmentBuilder.builder(attachment);
        return this.updateIn(['map', 'attachments'],
            (attachments = List()) => attachments.insert(full_attachment));
    }

    /**
    * Add a `context` `statement` as a StatementRef
    *
    * Accepts a StatementBuilder object, a simple javascript Statement or
    * StatementRef object, or the uuid `id` of the Statement referred to.
    * @param {uuid|Object} statement the Statement to refer to.
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withContextStatement(statement) {
        let uuid;
        if(typeof statement === 'string') {
            uuid = statement;
        } else if(statement instanceof BuilderRecord) {
            uuid = statement.map.id;
        } else {
            uuid = statement.id;
        }
        return this.setIn(['map', 'context', 'statement'], fromJS({
            id: uuid, objectType: 'StatementRef'
        }));
    }

    /**
    * @ignore
    */
    withPath(path, value) {
        return this.setIn(['map'].concat(path), value);
    }

    /**
    * Add the `id` for the Statement
    *
    * @param {uuid} uuid the `id`.
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withId(uuid) {
        return this.withPath(['id'], uuid);
    }

    /**
    * Add the ISO 8601 `timestamp` the Statement occurred
    *
    * @param {string} timestamp the `timestamp`.
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withTimestamp(timestamp) {
        // TODO take other representations?
        return this.withPath(['timestamp'], timestamp);
    }

    /**
    * Set the Statement as occurring at the current time.
    *
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withCurrentTimestamp() {
        // TODO this

    }

    /**
    * Add the ISO 8601 `stored` time for the Statement
    *
    * @param {string} timestamp the `stored` time.
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withStored(timestamp) {
        return this.withPath(['stored'], timestamp);
    }

    /**
    * Add the xAPI `version` of the Statement
    *
    * @param {string} version the `version`.
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withVersion(version) {
        return this.withPath(['version'], version);
    }


    /**
    * Add a score scaled to between -1 and 1 (inclusive) for the Statement
    * `result`
    *
    * @param {number} score the score.
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withScaledScore(score) {
        return this.withPath(['result', 'score', 'scaled'], score);
    }

    /**
    * Add a raw score for the Statement `result`
    *
    * @param {number} score the score.
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withRawScore(score) {
        return this.withPath(['result', 'score', 'raw'], score);
    }

    /**
    * Add a minimum score bound (inclusive) for the raw score.
    *
    * @param {number} score the score.
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withMinScore(score) {
        return this.withPath(['result', 'score', 'min'], score);
    }

    /**
    * Add a maximum score bound (inclusive) for the raw score.
    *
    * @param {number} score the score.
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withMaxScore(score) {
        return this.withPath(['result', 'score', 'max'], score);
    }

    /**
    * Add a boolean `success` for the Statement `result`
    *
    * @param {boolean} success successful?
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withSuccess(success) {
        return this.withPath(['result', 'success'], success);
    }

    /**
    * Mark the Statement `result` as succeeding
    *
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    asSucceeded() {
        return this.withSuccess(true);
    }

    /**
    * Mark the Statement `result` as failing
    *
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    asFailed() {
        return this.withSuccess(false);
    }

    /**
    * Add a boolean `completion` for the Statement `result`
    *
    * @param {boolean} completion complete?
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withCompletion(completion) {
        return this.withPath(['result', 'completion'], completion);
    }

    /**
    * Mark the Statement `result` as complete
    *
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    asComplete() {
        return this.withCompletion(true);
    }

    /**
    * Mark the Statement `result` as incomplete
    *
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    asIncomplete() {
        return this.withCompletion(false);
    }

    /**
    * Add a `response` for the Statement `result`
    *
    * @param {string} response the `response`
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withResponse(response) {
        return this.withPath(['result', 'response'], response);
    }

    /**
    * Add an ISO 8601 `duration` for the Statement `result`
    *
    * @param {string} duration the `duration`
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withDuration(duration) {
        // TODO add seconds conversion niceties
        return this.withPath(['result', 'duration'], duration);
    }


    /**
    * Add a `registration` for the Statement `context`
    *
    * @param {uuid} uuid the `registration`
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withRegistration(uuid) {
        return this.withPath(['context', 'registration'], uuid);
    }

    /**
    * Add a `revision` for the Statement `context`
    *
    * @param {string} revision the `revision`
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withRevision(revision) {
        return this.withPath(['context', 'revision'], revision);
    }

    /**
    * Add a `platform` for the Statement `context`
    *
    * @param {string} platform the `platform`
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withPlatform(platform) {
        return this.withPath(['context', 'platform'], platform);
    }

    /**
    * Add a `language` for the Statement `context`
    *
    * @param {string} language the `language`
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withLanguage(language) {
        return this.withPath(['context', 'language'], language);
    }

    /**
    * TODO document
    *
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withCurrentLanguage() {
        // TODO look up from environment
    }

    /**
    * @ignore
    */
    withAgent(location, agent) {
        agent = agent.map || fromJS(agent);
        const path = ['map'].concat(location);
        return this.setIn(path, agent);
    }

    /**
    * Add the `actor` for the Statement
    *
    * There are two ways to provide the agent:
    *   * As a AgentBuilder from this library.
    *   * as a complete simple javascript object of an Agent or Group.
    * @param {AgentBuilder|Object} agent the agent
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withActor(agent) {
        return this.withAgent(['actor'], agent);
    }

    /**
    * Add the `authority` for the Statement
    *
    * There are two ways to provide the agent:
    *   * As a AgentBuilder from this library.
    *   * as a complete simple javascript object of an Agent or Group.
    * @param {AgentBuilder|Object} agent the agent
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withAuthority(agent) {
        return this.withAgent(['authority'], agent);
    }

    /**
    * Add the `instructor` to the `context` for the Statement
    *
    * There are two ways to provide the agent:
    *   * As a AgentBuilder from this library.
    *   * as a complete simple javascript object of an Agent or Group.
    * @param {AgentBuilder|Object} agent the agent
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withInstructor(agent) {
        return this.withAgent(['context', 'instructor'], agent);
    }

    /**
    * Add the `team` to the `context` for the Statement
    *
    * There are two ways to provide the agent:
    *   * As a AgentBuilder from this library.
    *   * as a complete simple javascript object of an Agent or Group.
    * @param {AgentBuilder|Object} agent the agent
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withTeam(agent) {
        return this.withAgent(['context', 'team'], agent);
    }

    /**
    * @ignore
    */
    withAgentMethod(location, method, args) {
        const path = ['map'].concat(location);
        const agent = AgentBuilder.builder(this.getIn(path))[method](...args);
        return this.setIn(path, agent.map);
    }

    /**
    * Add an `mbox` to the `actor` based on an email
    *
    * @param {string} email Email to use for the Agent/Group `mbox` property
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withActorEmail(email) {
        return this.withAgentMethod(['actor'], 'withEmail', arguments);
    }

    /**
    * Add a personal or descriptive name for the `actor`
    *
    * @param {string} name Name to use for the Agent/Group `name` property.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withActorName(name) {
        return this.withAgentMethod(['actor'], 'withName', arguments);
    }

    /**
    * Add the `homePage` URL of an `account` to the `actor`
    *
    * @param {uri} homePage URL to use for the Agent/Group `account`
    * `homePage` property
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withActorHomePage(homePage) {
        return this.withAgentMethod(['actor'], 'withHomePage', arguments);
    }

    /**
    * Add the `name` identifier of an `account` to the `actor`. This is a unique identifier
    * the system identified by `homePage` links to a particular account.
    *
    * @param {string} name Name to use for the Agent/Group `account` `name`
    * property.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withActorAccountName(name) {
        return this.withAgentMethod(['actor'], 'withAccountName', arguments);
    }

    /**
    * Makes the `actor` a Group.
    *
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    actorAsGroup() {
        return this.withAgentMethod(['actor'], 'asGroup', arguments);
    }

    /**
    * Adds an Agent as a `member` of the `actor`.
    *
    * @param {Object} agent An AgentBuilder or a plain Javascript object
    * representing a complete Agent, to add to the `member` property.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withActorMember(agent) {
        return this.withAgentMethod(['actor'], 'withMember', arguments);
    }


    /**
    * Identify this `actor` with an `mbox` (must start with `mailto:`!)
    * @param {uri} mbox What to set the `mbox` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withActorMbox(mbox) {
        return this.withAgentMethod(['actor'], 'withMbox', arguments);
    }

    /**
    * Identify this `actor` with an `mbox_sha1sum`
    * @param {string} sha1 What to set the `mbox_sha1sum` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withActorMbox_sha1sum(sha1) {
        return this.withAgentMethod(['actor'], 'withMbox_sha1sum', arguments);
    }

    /**
    * Identify this `actor` with an `openid`
    * @param {uri} openid URI to set the `openid` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withActorOpenid(openid) {
        return this.withAgentMethod(['actor'], 'withOpenid', arguments);
    }

    /**
    * Identify this `actor` with an `account`
    * @param {{homePage: uri, name: string}} account object to set `account`
    * to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withActorAccount(account) {
        return this.withAgentMethod(['actor'], 'withAccount', arguments);
    }

    /**
    * Add an `mbox` to the `authority` based on an email
    *
    * @param {string} email Email to use for the Agent/Group `mbox` property
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withAuthorityEmail(email) {
        return this.withAgentMethod(['authority'], 'withEmail', arguments);
    }

    /**
    * Add a personal or descriptive name for the `authority`
    *
    * @param {string} name Name to use for the Agent/Group `name` property.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withAuthorityName(name) {
        return this.withAgentMethod(['authority'], 'withName', arguments);
    }

    /**
    * Add the `homePage` URL of an `account` to the `authority`
    *
    * @param {uri} homePage URL to use for the Agent/Group `account`
    * `homePage` property
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withAuthorityHomePage(homePage) {
        return this.withAgentMethod(['authority'], 'withHomePage', arguments);
    }

    /**
    * Add the `name` identifier of an `account` to the `authority`. This is a unique identifier
    * the system identified by `homePage` links to a particular account.
    *
    * @param {string} name Name to use for the Agent/Group `account` `name`
    * property.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withAuthorityAccountName(name) {
        return this.withAgentMethod(['authority'], 'withAccountName', arguments);
    }

    /**
    * Makes the `authority` a Group.
    *
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    authorityAsGroup() {
        return this.withAgentMethod(['authority'], 'asGroup', arguments);
    }

    /**
    * Adds an Agent as a `member` of the `authority`.
    *
    * @param {Object} agent An AgentBuilder or a plain Javascript object
    * representing a complete Agent, to add to the `member` property.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withAuthorityMember(agent) {
        return this.withAgentMethod(['authority'], 'withMember', arguments);
    }


    /**
    * Identify this `authority` with an `mbox` (must start with `mailto:`!)
    * @param {uri} mbox What to set the `mbox` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withAuthorityMbox(mbox) {
        return this.withAgentMethod(['authority'], 'withMbox', arguments);
    }

    /**
    * Identify this `authority` with an `mbox_sha1sum`
    * @param {string} sha1 What to set the `mbox_sha1sum` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withAuthorityMbox_sha1sum(sha1) {
        return this.withAgentMethod(['authority'], 'withMbox_sha1sum', arguments);
    }

    /**
    * Identify this `authority` with an `openid`
    * @param {uri} openid URI to set the `openid` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withAuthorityOpenid(openid) {
        return this.withAgentMethod(['authority'], 'withOpenid', arguments);
    }

    /**
    * Identify this `authority` with an `account`
    * @param {{homePage: uri, name: string}} account object to set `account`
    * to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withAuthorityAccount(account) {
        return this.withAgentMethod(['authority'], 'withAccount', arguments);
    }

    /**
    * Add an `mbox` to the `team` based on an email
    *
    * @param {string} email Email to use for the Agent/Group `mbox` property
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withTeamEmail(email) {
        return this.withAgentMethod(['context', 'team'], 'withEmail', arguments);
    }

    /**
    * Add a personal or descriptive name for the `team`
    *
    * @param {string} name Name to use for the Agent/Group `name` property.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withTeamName(name) {
        return this.withAgentMethod(['context', 'team'], 'withName', arguments);
    }

    /**
    * Add the `homePage` URL of an `account` to the `team`
    *
    * @param {uri} homePage URL to use for the Agent/Group `account`
    * `homePage` property
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withTeamHomePage(homePage) {
        return this.withAgentMethod(['context', 'team'], 'withHomePage', arguments);
    }

    /**
    * Add the `name` identifier of an `account` to the `team`. This is a unique identifier
    * the system identified by `homePage` links to a particular account.
    *
    * @param {string} name Name to use for the Agent/Group `account` `name`
    * property.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withTeamAccountName(name) {
        return this.withAgentMethod(['context', 'team'], 'withAccountName', arguments);
    }

    /**
    * Makes the `team` a Group.
    *
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    teamAsGroup() {
        return this.withAgentMethod(['context', 'team'], 'asGroup', arguments);
    }

    /**
    * Adds an Agent as a `member` of the `team`.
    *
    * @param {Object} agent An AgentBuilder or a plain Javascript object
    * representing a complete Agent, to add to the `member` property.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withTeamMember(agent) {
        return this.withAgentMethod(['context', 'team'], 'withMember', arguments);
    }


    /**
    * Identify this `team` with an `mbox` (must start with `mailto:`!)
    * @param {uri} mbox What to set the `mbox` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withTeamMbox(mbox) {
        return this.withAgentMethod(['context', 'team'], 'withMbox', arguments);
    }

    /**
    * Identify this `team` with an `mbox_sha1sum`
    * @param {string} sha1 What to set the `mbox_sha1sum` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withTeamMbox_sha1sum(sha1) {
        return this.withAgentMethod(['context', 'team'], 'withMbox_sha1sum', arguments);
    }

    /**
    * Identify this `team` with an `openid`
    * @param {uri} openid URI to set the `openid` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withTeamOpenid(openid) {
        return this.withAgentMethod(['context', 'team'], 'withOpenid', arguments);
    }

    /**
    * Identify this `team` with an `account`
    * @param {{homePage: uri, name: string}} account object to set `account`
    * to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withTeamAccount(account) {
        return this.withAgentMethod(['context', 'team'], 'withAccount', arguments);
    }

    /**
    * Add an `mbox` to the `instructor` based on an email
    *
    * @param {string} email Email to use for the Agent/Group `mbox` property
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withInstructorEmail(email) {
        return this.withAgentMethod(['context', 'instructor'], 'withEmail', arguments);
    }

    /**
    * Add a personal or descriptive name for the `instructor`
    *
    * @param {string} name Name to use for the Agent/Group `name` property.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withInstructorName(name) {
        return this.withAgentMethod(['context', 'instructor'], 'withName', arguments);
    }

    /**
    * Add the `homePage` URL of an `account` to the `instructor`
    *
    * @param {uri} homePage URL to use for the Agent/Group `account`
    * `homePage` property
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withInstructorHomePage(homePage) {
        return this.withAgentMethod(['context', 'instructor'], 'withHomePage', arguments);
    }

    /**
    * Add the `name` identifier of an `account` to the `instructor`. This is a unique identifier
    * the system identified by `homePage` links to a particular account.
    *
    * @param {string} name Name to use for the Agent/Group `account` `name`
    * property.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withInstructorAccountName(name) {
        return this.withAgentMethod(['context', 'instructor'], 'withAccountName', arguments);
    }

    /**
    * Makes the `instructor` a Group.
    *
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    instructorAsGroup() {
        return this.withAgentMethod(['context', 'instructor'], 'asGroup', arguments);
    }

    /**
    * Adds an Agent as a `member` of the `instructor`.
    *
    * @param {Object} agent An AgentBuilder or a plain Javascript object
    * representing a complete Agent, to add to the `member` property.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withInstructorMember(agent) {
        return this.withAgentMethod(['context', 'instructor'], 'withMember', arguments);
    }


    /**
    * Identify this `instructor` with an `mbox` (must start with `mailto:`!)
    * @param {uri} mbox What to set the `mbox` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withInstructorMbox(mbox) {
        return this.withAgentMethod(['context', 'instructor'], 'withMbox', arguments);
    }

    /**
    * Identify this `instructor` with an `mbox_sha1sum`
    * @param {string} sha1 What to set the `mbox_sha1sum` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withInstructorMbox_sha1sum(sha1) {
        return this.withAgentMethod(['context', 'instructor'], 'withMbox_sha1sum', arguments);
    }

    /**
    * Identify this `instructor` with an `openid`
    * @param {uri} openid URI to set the `openid` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withInstructorOpenid(openid) {
        return this.withAgentMethod(['context', 'instructor'], 'withOpenid', arguments);
    }

    /**
    * Identify this `instructor` with an `account`
    * @param {{homePage: uri, name: string}} account object to set `account`
    * to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withInstructorAccount(account) {
        return this.withAgentMethod(['context', 'instructor'], 'withAccount', arguments);
    }

    /**
    * Add an `mbox` to the `object` based on an email
    *
    * @param {string} email Email to use for the Agent/Group `mbox` property
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectEmail(email) {
        return this.withAgentMethod(['object'], 'withEmail', arguments);
    }

    /**
    * Add the `homePage` URL of an `account` to the `object`
    *
    * @param {uri} homePage URL to use for the Agent/Group `account`
    * `homePage` property
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectHomePage(homePage) {
        return this.withAgentMethod(['object'], 'withHomePage', arguments);
    }

    /**
    * Add the `name` identifier of an `account` to the `object`. This is a unique identifier
    * the system identified by `homePage` links to a particular account.
    *
    * @param {string} name Name to use for the Agent/Group `account` `name`
    * property.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectAccountName(name) {
        return this.withAgentMethod(['object'], 'withAccountName', arguments);
    }

    /**
    * Makes the `object` a Group.
    *
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    objectAsGroup() {
        return this.withAgentMethod(['object'], 'asGroup', arguments);
    }

    /**
    * Adds an Agent as a `member` of the `object`.
    *
    * @param {Object} agent An AgentBuilder or a plain Javascript object
    * representing a complete Agent, to add to the `member` property.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectMember(agent) {
        return this.withAgentMethod(['object'], 'withMember', arguments);
    }


    /**
    * Identify this `object` with an `mbox` (must start with `mailto:`!)
    * @param {uri} mbox What to set the `mbox` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectMbox(mbox) {
        return this.withAgentMethod(['object'], 'withMbox', arguments);
    }

    /**
    * Identify this `object` with an `mbox_sha1sum`
    * @param {string} sha1 What to set the `mbox_sha1sum` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectMbox_sha1sum(sha1) {
        return this.withAgentMethod(['object'], 'withMbox_sha1sum', arguments);
    }

    /**
    * Identify this `object` with an `openid`
    * @param {uri} openid URI to set the `openid` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectOpenid(openid) {
        return this.withAgentMethod(['object'], 'withOpenid', arguments);
    }

    /**
    * Identify this `object` with an `account`
    * @param {{homePage: uri, name: string}} account object to set `account`
    * to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectAccount(account) {
        return this.withAgentMethod(['object'], 'withAccount', arguments);
    }



    withActivityMethod(method, args) {
        const path = ['map', 'object'];
        const activity = ActivityBuilder.builder(this.getIn(path))[method](...args);
        return this.setIn(path, activity.map);
    }

    /**
    * Set an Activity `object` `id`
    *
    * If the `id` is not a URI but matches a name of an Activity in a Profile
    * loaded by {@link StatementBuilder#withProfile}, the `id` of that Activity will
    * be used. Throws an error if the `id` does not match a name and is not
    * uri-like.
    * @param {uri|string} id URI to set the `id` to or name of an Activity from
    * a Profile.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectId(id) {
        return this.withActivityMethod('withId', arguments);
    }

    /**
    * Set the Activity `object` `type`
    *
    * If the `type` is not a URI but matches a name of an Activity Type in a
    * Profile loaded by {@link StatementBuilder#withProfile}, the uri of that
    * Activity Type will be used. Throws an error if the `type` does not match
    * a name and is not uri-like.
    * @param {uri|string} type URI to set the `type` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectType(type) {
        return this.withActivityMethod('withType', arguments);
    }

    /**
    * Add an extension to the Activity `object` `definition`
    *
    * If the `key` is not a URI but matches a name of an Activity Extension in a
    * Profile loaded by {@link StatementBuilder#withProfile}, the uri of that
    * Activity Extension will be used. Throws an error if the `key` does not
    * match a name and is not uri-like.
    * @param {uri|string} key URI key of the extension
    * @param {*} value any JSON-legal data structure
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectExtension(key, value) {
        return this.withActivityMethod('withExtension', arguments);
    }


    /**
    * Add a `moreInfo` URL to an Activity `object`
    *
    * @param {uri} url URL to use for `moreInfo`.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectMoreInfo(url) {
        return this.withActivityMethod('withMoreInfo', arguments);
    }

    /**
    * Add an `interactionType` to an Activity `object`
    *
    * @param {string} value `interactionType` to use.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectInteractionType(value) {
        return this.withActivityMethod('withInteractionType', arguments);
    }

    /**
    * Add possible `correctResponsesPattern` values to an Activity `object`
    *
    * @param {string[]} responses strings indicating possible
    * `correctResponsesPattern` values
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectCorrectResponsesPattern(responses) {
        return this.withActivityMethod('withCorrectResponsesPattern', arguments);
    }

    /**
    * Add available `choices` for this interaction to an Activity `object`
    *
    * @param {InteractionComponent[]} choices interaction components with string `id`
    * and language map `description`
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectChoices(choices) {
        return this.withActivityMethod('withChoices', arguments);
    }

    /**
    * Add `scale` values for this interaction to an Activity `object`
    *
    * @param {InteractionComponent[]} scale interaction components with string `id`
    * and language map `description`
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectScale(scale) {
        return this.withActivityMethod('withScale', arguments);
    }

    /**
    * Add available `source` values for this interaction to an Activity `object`
    *
    * @param {InteractionComponent[]} source interaction components with string `id`
    * and language map `description`
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectSource(source) {
        return this.withActivityMethod('withSource', arguments);
    }

    /**
    * Add available `target` values for this interaction to an Activity `object`
    *
    * @param {InteractionComponent[]} target interaction components with string `id`
    * and language map `description`
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectTarget(target) {
        return this.withActivityMethod('withTarget', arguments);
    }

    /**
    * Add available `steps` for this interaction to an Activity `object`
    *
    * @param {InteractionComponent[]} steps interaction components with string `id`
    * and language map `description`
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectSteps(steps) {
        return this.withActivityMethod('withSteps', arguments);
    }


    /**
    * Add a `definition` for this Activity `object` in a particular `language`
    *
    * @param {string} definition the definition of this Activity in that
    * language.
    * @param {string} language an RFC 5646 language tag, such as `en` or
    * `zh-Hans`.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectDefinition(definition, language) {
        return this.withActivityMethod('withDefinition', arguments);
    }






    /**
    * Add a name for the `object` -- a personal or descriptive name
    * for an Agent or Group, or the name of an Activity in a `language`
    *
    * @param {string} name The language-specific name for an Activity or the
    * Agent/Group name.
    * @param {?string} language an RFC 5646 language tag, such as `en` or
    * `zh-Hans`. Only use for Activity objects.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withObjectName(name, language) {
        if(arguments.length == 1) {
            return this.withAgentMethod(['object'], 'withName', arguments);
        } else {
            return this.withActivityMethod('withName', arguments);
        }
    }


    /**
    * @ignore
    */
    withContextActivity(variety, activity) {
        const path = ['map', 'context', 'contextActivities', variety];
        if(typeof activity === 'string') {
            full_activity = fromJS(this.lookup(activity, 'Activity'));
        } else if(activity instanceof BuilderRecord) {
            full_activity = activity.map;
        } else {
            full_activity = fromJS(activity);
        }
        return this.updateIn(path,
            (activities = List()) => activities.insert(full_activity));
    }


    /**
    * Add an Activity to the `category` `contextActivities` in `context`
    *
    * There are several possible ways to provide the Activity:
    *   * As a name or URI of an Activity. If the Activity is found in a
    * Profile loaded by {@link StatementBuilder#withProfile}, the complete
    * Profile representation of that Activity will be used. Throws an error
    * if a name does not match an Activity and is not uri-like.
    *   * As a builder from this library for an Activity.
    *   * as a complete simple javascript object of an Activity.
    * @param {uri|string|Object} activity the Activity to use
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withContextCategory(activity) {
        return this.withContextActivity('category', activity);
    }

    /**
    * Add an Activity to the `parent` `contextActivities` in `context`
    *
    * There are several possible ways to provide the Activity:
    *   * As a name or URI of an Activity. If the Activity is found in a
    * Profile loaded by {@link StatementBuilder#withProfile}, the complete
    * Profile representation of that Activity will be used. Throws an error
    * if a name does not match an Activity and is not uri-like.
    *   * As a builder from this library for an Activity.
    *   * as a complete simple javascript object of an Activity.
    * @param {uri|string|Object} activity the Activity to use
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withContextParent(activity) {
        return this.withContextActivity('parent', activity);
    }

    /**
    * Add an Activity to the `grouping` `contextActivities` in `context`
    *
    * There are several possible ways to provide the Activity:
    *   * As a name or URI of an Activity. If the Activity is found in a
    * Profile loaded by {@link StatementBuilder#withProfile}, the complete
    * Profile representation of that Activity will be used. Throws an error
    * if a name does not match an Activity and is not uri-like.
    *   * As a builder from this library for an Activity.
    *   * as a complete simple javascript object of an Activity.
    * @param {uri|string|Object} activity the Activity to use
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withContextGrouping(activity) {
        return this.withContextActivity('grouping', activity);
    }

    /**
    * Add an Activity to the `other` `contextActivities` in `context`
    *
    * There are several possible ways to provide the Activity:
    *   * As a name or URI of an Activity. If the Activity is found in a
    * Profile loaded by {@link StatementBuilder#withProfile}, the complete
    * Profile representation of that Activity will be used. Throws an error
    * if a name does not match an Activity and is not uri-like.
    *   * As a builder from this library for an Activity.
    *   * as a complete simple javascript object of an Activity.
    * @param {uri|string|Object} activity the Activity to use
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withContextOther(activity) {
        return this.withContextActivity('other', activity);
    }


    /**
    * @ignore
    */
    withExtension(location, key, value) {
        const extension = this.lookup(key, capitalize(location) + 'Extension')
        return this.setIn(['map', location, extension.id], fromJS(value));
    }

    /**
    * Add an extension to the `context`
    *
    * If the `key` is not a URI but matches a name of a Context Extension in a
    * Profile loaded by {@link StatementBuilder#withProfile}, the uri of that
    * Context Extension will be used. Throws an error if the `key` does not
    * match a name and is not uri-like.
    * @param {uri|string} key URI key of the extension
    * @param {*} value any JSON-legal data structure
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withContextExtension(key, value) {
        return this.withExtension('context', key, value);
    }


    /**
    * Add an extension to the `result`
    *
    * If the `key` is not a URI but matches a name of a Result Extension in a
    * Profile loaded by {@link StatementBuilder#withProfile}, the uri of that
    * Result Extension will be used. Throws an error if the `key` does not
    * match a name and is not uri-like.
    * @param {uri|string} key URI key of the extension
    * @param {*} value any JSON-legal data structure
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    */
    withResultExtension(key, value) {
        return this.withExtension('result', key, value);
    }




    /**
    * Makes this create a SubStatement (StatementBuilder makes Statements by
    * default).
    *
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    asSubStatement() {
        // TODO: return a version of this with a different build method,
        // that tidies up for being a SubStatement
    }

    /**
    * An ActivityBuilder derived from this StatementBuilder, knowing about
    * all the same Profiles.
    *
    * @type {ActivityBuilder}
    */
    get activities() {
        return ActivityBuilder.builder().set('oracle', this.oracle);
    }


    /**
    * An AgentBuilder derived from this StatementBuilder, knowing about
    * all the same Profiles.
    *
    * @type {AgentBuilder}
    */
    get agents() {
        return AgentBuilder.builder().set('oracle', this.oracle);
    }

    /**
    * An AttachmentBuilder derived from this StatementBuilder, knowing about
    * all the same Profiles.
    *
    * @type {AttachmentBuilder}
    */
    get attachments() {
        return AttachmentBuilder.builder().set('oracle', this.oracle);
    }

    /**
    * @ignore
    */
    prebuild() {
        return BuilderRecord.builder({
            id: uuidv1(),
            timestamp: new Date().toISOString()
        }).merge(this);  // overwrites with existing id/timestamp if present
    }

    /**
    * @ignore
    */
    pattern(name) {
        // TODO: figure out how this works. Question the args. Question what
        // methods enable all this.
        // Maybe have a no-arg "next" and then each call to pattern(top level name, template) overlays the current statement?
        // I think that might work. Also allow pattern(top level name) and then a bunch of next and template calls? Yeah... maybe?
    }


}



// TODO have language controls. That warn when a language isn't available!
// and have tunable behavior. Default: if good substitute, use, otherwise no language.
// options: use *something* no matter what, only use exact, and the default



// Then: oracles. Statement Templates. Validation. ...Patterns with registration automation?
// start with basic validation? Or put that off actually?

// idea for patterns: next(templatename), gives a new builder for the new template

// let me see: builder.withStuff().pattern(patternname, templatename).withOtherStuff().next(templatename)
// ... keeps the things from withStuff? That is, we save (a stack of?) versions of the Statement
// as we transition different contexts? That's kinda pretty, and seems to make a decent bit of sense
