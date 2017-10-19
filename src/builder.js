import { Record, Map, List, fromJS, Set } from 'immutable';
import uuidv1 from 'uuid/v1';
import * as _ from "lodash";
import jsonpath from "jsonpath";

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

/**
* @ignore
*/
function capitalize(s) {
    return s[0].toUpperCase() + s.slice(1);
}

/**
* @ignore
*/
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

/**
* @ignore
*/
const _BuilderRecord = Record({
    map: Map(),
    instanceIdentifier: null,  // contract: must be UUID
    oracle: new CompositeOracle().add(uriOracle)
});

/**
* The base class of most of the library, this provides a few utility data
* structures and methods.
*/
class BuilderRecord extends _BuilderRecord {

    /**
    * Make an instance of a Builder
    *
    * Don't call BuilderRecord.builder directly. Generally, call
    * {@link StatementBuilder#builder} then access all the other builders from that
    * Builder, as {@link StatementBuilder#activities},
    * {@link StatementBuilder#agents}, or {@link StatementBuilder#attachments}.
    * @param {?Object} value A plain javascript Object to start the Builder with
    * @return {*} A Builder of the type called on.
    */
    static builder(value) {
        const record = new this().set('instanceIdentifier', uuidv1());
        if(value instanceof this) {
            // already a real one, just return it
            return value;
        } else if(value instanceof BuilderRecord) {
            // some other kind of Builder Record.
            // NOTE: this is primarily to make SubStatements work right.
            // Only pass builders to their subclasses.
            return record.merge(value);
        } else if(value) {
            return record.merge(new Map({
                map: new Map(value)
            }));
        } else {
            return record;
        }
    }

    /**
    * @ignore
    */
    validate(js) {
        // TODO: implement this in subclasses
        // there doesn't seem to be a good JS xAPI validation library out there,
        // especially not with a suitable license.
        // Also consider, should we make it pluggable?
        return;
    }

    /**
    * @ignore
    */
    prebuild() {
        return this;
    }

    /**
    * Get the plain javascript object from this builder, ready to serialize
    * into JSON
    *
    * Will throw an exception if the result does not validate (currently only
    * xAPI Profile Statement Template validation occurs, not overall Statement
    * validation).
    * @return {Object} the plain javascript object constructed by this builder.
    */
    build() {
        const js = this.prebuild().map.toJS();
        this.validate(js);
        return js;
    }

    /**
    * _Without validating_, get the plain javascript object from this builder,
    * ready to serialize into JSON
    *
    * @return {Object} the plain javascript object constructed by this builder.
    */
    unsafeBuild() {
        return this.prebuild().map.toJS();
    }

    /**
    * @ignore
    */
    lookup(identifier, objectType) {
        const found = this.oracle.lookup(identifier, objectType);
        if(found) {
            return adapt(found);
        } else {
            throw new Error("No " + objectType + " found for: '" + identifier + "'");
        }
    }
}

const [SUCCESS, PARTIAL, FAILURE] = [2,1,0]


export class PatternRegistration extends BuilderRecord {

    /**
    * @ignore
    */
    static builder(profile_version, patterns, pattern) {
        return super.builder({
            profile_version,
            patterns,
            pattern: fromJS(pattern),
            templates_so_far: []
        });
    }

    /**
    * @ignore
    */
    recordTemplate(template) {
        this._checkNextMatch(template.id);
        this.getIn(['map', 'templates_so_far']).push(template.id);
    }

    /**
    * @ignore
    */
    _checkNextMatch(template) {
        const sequence = [].concat(this.getIn(['map', 'templates_so_far']), template);
        if(!this._sequencePossible(sequence, this.getIn(['map', 'pattern', 'id']))) {
            throw new Error(`That template is not allowed next for the pattern ${this.getIn(['map', 'pattern', 'id'])}`);
        }
    }

    /**
    * @ignore
    */
    _sequencePossible(sequence, pattern) {
        const {success, remaining} = this._matches(sequence, pattern);
        switch(success) {
            case SUCCESS:
                return remaining.length == 0;
            case PARTIAL:
                return true;
            case FAILURE:
                return false;
        }
    }

    /**
    * @ignore
    */
    _matches(statements, element) {
        const is_template = !this.hasIn(['map', 'patterns', element]);
        if(is_template) {
            if(statements.length == 0) {
                return {
                    success: PARTIAL,
                    remaining: []
                };
            }
            const [next, ...remaining] = statements;
            if(next === element) {
                return {
                    success: SUCCESS,
                    remaining
                };
            }
            return {
                success: FAILURE,
                remaining: statements
            };
        }

        const pattern = this.getIn(['map', 'patterns', element]);
        if(pattern.has('sequence')) {
            let [success, remaining] = [SUCCESS, statements];
            for(let next of pattern.get('sequence')) {
                ({success, remaining} = this._matches(remaining, next));
                if(success === FAILURE) {
                    return {
                        success,
                        remaining: statements
                    }
                }
                if(success == PARTIAL) {
                    return {
                        success,
                        remaining: []
                    }
                }
            }
            return {
                success,
                remaining
            }
        }
        if(pattern.has('alternates')) {
            let [success, remaining] = [FAILURE, statements];
            for(let next of pattern.get('alternates')) {
                const maybe = this._matches(statements, next);
                if(maybe.success === SUCCESS) {
                    success = SUCCESS;
                    if(maybe.statements.length < remaining.length) {
                        remaining = maybe.statements;
                    }
                }
                if(maybe.success === PARTIAL && success === FAILURE) {
                    success = PARTIAL
                }
            }
            if(success === PARTIAL) {
                return {
                    success,
                    remaining: []
                };
            }
            return {
                success,
                remaining
            };
        }
        if(pattern.has('oneOrMore')) {
            let [success, remaining] = [FAILURE, statements];
            let last_statements = remaining;
            while(true) {
                const maybe = this._matches(last_statements, pattern.get('oneOrMore'));
                if(maybe.success === SUCCESS) {
                    success = SUCCESS;
                } else if(success === FAILURE && maybe.success === PARTIAL) {
                    return {
                        success: PARTIAL,
                        remaining: []
                    };
                } else {
                    if(maybe.success === PARTIAL && last_statements.length > 0) {
                        return {
                            success: PARTIAL,
                            remaining: last_statements
                        };
                    } else {
                        return {
                            success,
                            remaining: last_statements
                        };
                    }
                }
                if(remaining.length === last_statements.length) {
                    return {
                        success,
                        remaining
                    }
                }
                last_statements = remaining;
            }
        }
        if(pattern.has('zeroOrMore')) {
            let last_statements = statements;
            while(true) {
                const {success, remaining} = this._matches(last_statements, pattern.get('zeroOrMore'));
                if(success === FAILURE) {
                    return {
                        success: SUCCESS,
                        remaining: last_statements
                    };
                }
                if(success === PARTIAL && remaining.length > 0) {
                    return {
                        success,
                        remaining
                    };
                }
                if(remaining.length === last_statements.length) {
                    return {
                        success: SUCCESS,
                        remaining
                    };
                }
                last_statements = remaining;
            }
        }
        if(pattern.has('optional')) {
            if(statements.length == 0) {
                return {
                    success: SUCCESS,
                    remaining: []
                };
            }
            let [success, remaining] = this._matches(statements, pattern.get('optional'));
            if(success === SUCCESS || success === PARTIAL) {
                return {
                    success,
                    remaining
                };
            } else {
                return {
                    success: SUCCESS,
                    remaining: statements
                };
            }
        }

    }
}

/**
* If you want to create Statements as parts of Patterns, start with a
* ProfileRegistration, add Profiles using
* {@link ProfileRegistration#withProfile}, create instances of Patterns with
* {@link ProfileRegistration#pattern}, then create StatementBuilders that
* follow Statement Templates with {@link ProfileRegistration#template}.
*
* @example
* var registration = ProfileRegistration.builder().withProfile({
*     ...profile object...
* });
*
* var coursePattern = registration.pattern("Course Pattern");
*
* var launched = registration.template("Launching", coursePattern);
*
* launched = launched.with...
* ...more additions to the StatementBuilder...
*
* my_send_statement_function(launched.build());
*/
export class ProfileRegistration extends BuilderRecord {

    /**
    * @ignore
    */
    withOracle(oracle) {
        return this.update('oracle', (main) => main.add(oracle));
    }

    /**
    * Add an xAPI Profile to enable referring to terms by name instead of URI
    * with later API calls
    *
    * The Profiles added here will also be available to StatementBuilders
    * returned from {@link ProfileRegistration#template}
    * @param {Object} profile a complete xAPI Profile as a JSON object.
    * @return {ProfileRegistration} returns the updated builder object. The
    * original is unmodified.
    */
    withProfile(profile) {
        const patterns = profile.patterns || [];
        const current = [].concat(
            profile.concepts || [], profile.templates || [], patterns
        )[0].inScheme; // every concept, template, and patter must be inScheme
        // of the current profile version
        return this.withOracle(ProfileOracle.fromProfile(profile)).mergeDeepIn(
            ['map', 'lookups'], {
                profile_patterns: new Map(patterns.map(pattern =>
                    [profile.id, new Map({[pattern.id]: fromJS(pattern)})])),
                pattern_profiles: new Map(patterns.map(pattern =>
                    [pattern.id, profile.id]
                )),
                current_versions: {
                    [profile.id]: current
                }
            });
    }

    /**
    * Make an opaque {@link PatternRegistration} object representing the Statements in
    * one Pattern of a Profile
    *
    * Pass the {@link PatternRegistration} to
    * {@link ProfileRegistration#template}.
    * @param {string} name the name or id of a Pattern in a Profile
    * registered with this object.
    * @return {PatternRegistration} returns an opaque bookkeeping object.
    * @throws {Error} if `name` does not match a name and is not uri-like.
    */
    pattern(name) {
        const pattern = this.lookup(name, 'Pattern');
        const profile = this.getIn(['map', 'lookups', 'pattern_profiles', pattern.id]);
        // TODO missing value handling!
        const patterns = this.getIn(['map', 'lookups', 'profile_patterns', profile])

        // TODO okay, now need to work out the version of the profile...
        const profile_version = this.getIn(['map', 'lookups', 'current_versions', profile]);
        return PatternRegistration.builder(profile_version, patterns, pattern);
    }

    /**
    * Make a {@link StatementBuilder} based on a Statement Template as part of
    * an instance of a Pattern
    *
    * The returned Builder will validate itself on
    * {@link StatementBuilder#build} against the requirements of the Statement
    * Template. The StatementBuilder will be prefilled with a `registration`,
    * a `subregistration` extension, and the profile version as a `context`
    * `category`. Additionally, if the Statement Template has a `verb` or
    * `objectActivityType`, the StatementBuilder will be prefilled with those
    * as well (but not other determining properties).
    * @param {string} name the name or id of a Statement Template in a Profile
    * registered with this object.
    * @param {PatternRegistration} pattern an opaque bookkeeping object.
    * @param {Object|StatementBuilder} [base] a plain Javascript object or
    * StatementBuilder to use as a base for the Statement.
    * @return {StatementBuilder} the partially-completed Statement
    * @throws {Error} if `name` does not match a name and is not uri-like, or if
    * the chosen Statement Template cannot follow Statements produced
    * from previous Statement Templates in the Pattern given.
    */
    template(name, pattern, base) {
        const template = this.lookup(name, 'StatementTemplate');
        pattern.recordTemplate(template);

        const profile_id = pattern.map.get('profile_version');
        return StatementBuilder.builder(
            base
        ).templated(
            template
        ).withRegistration(
            this.instanceIdentifier
        ).withContextExtension(
            "https://w3id.org/xapi/profiles/extensions/subregistration",
            [
                {
                    profile: profile_id,
                    subregistration: pattern.instanceIdentifier
                }
            ]
        ).withContextCategory(
            ActivityBuilder.builder().withId(profile_id)
        );
        // TODO make it possible to provide multiples of name, pattern

    }


}

/**
* Use AgentBuilder to make Agents for use in your Statements, though you
* mostly won't need to use it unless you're working with Groups. All non-member
* Agents in Statements can be manipulated with StatementBuilder methods.
*
* When working with Statements you should generally get an AgentBuilder
* instance by the {@link StatementBuilder#agents} property.
*
*/
export class AgentBuilder extends BuilderRecord {

    /**
    * Use `builder` to create instances of AgentBuilder.
    *
    * @example <caption>create an Agent with an mbox.</caption>
    * let builder = AgentBuilder.builder();
    * builder = builder.withEmail("nandita@example.gov");
    * console.log(builder.build());
    * @param {Object} [value] A plain javascript Agent or Group.
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

/**
* Use ActivityBuilder to make Activities, particularly ones you
* plan to put in `context`, since StatementBuilder does not provide methods
* to update them directly.
*
* When working with Statements you should generally get an ActivityBuilder
* instance by the {@link StatementBuilder#activities} property.
*
* @example
* var statement = StatementBuilder.builder().withProfile(....);
*
* // values passed to withId are looked up in Profiles
* var topic = StatementBuilder.activities.withId("Biology");
*
* statement = statement.withContextGrouping(topic);
*
* my_send_statement_function(statement.build());
*/
export class ActivityBuilder extends BuilderRecord {

    /**
    * Use `builder` to create instances of ActivityBuilder.
    * @param {Object} [value] A plain javascript Activity.
    * @return {ActivityBuilder} A builder for xAPI Activities.
    */
    static builder(value) {
        return super.builder(value).setIn(['map', 'objectType'], "Activity");
    }

    /**
    * Set the Activity `id`
    *
    * If the `id` is not a URI but matches a name of an Activity in a Profile
    * loaded by {@link StatementBuilder#withProfile}, the `id` of that Activity will
    * be used.
    * @param {uri|string} id URI to set the `id` to or name of an Activity from
    * a Profile.
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    * @throws {Error} if `id` does not match a name and is not uri-like.
    */
    withId(id) {
        const activity = this.lookup(id, 'Activity');
        return this.setIn(['map', 'id'], activity.id);
    }

    /**
    * Makes the Activity look exactly as in the Profile it is from.
    *
    * If no `id` is provided but one is set for the Activity, that will be used.
    * If the `id` is not a URI but matches a name of an Activity in a Profile
    * loaded by {@link StatementBuilder#withProfile}, that Activity will
    * be used.
    * @param {uri|string} [id] URI or string to lookup the Activity with
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    * @throws {Error} if `id` does not match a name and is not uri-like,
    * or if no `id` is provided or present.
    */
    asProfile(id) {
        if(!id) {
            if(this.map.has('id')) {
                id = this.map.get('id');
            } else {
                throw new Error("No id provided or already present");
            }
        }
        const activity = this.lookup(id, 'Activity');
        return ActivityBuilder.builder(value).set("oracle", this.oracle);
    }

    /**
    * Set the Activity `type`
    *
    * If the `type` is not a URI but matches a name of an Activity Type in a
    * Profile loaded by {@link StatementBuilder#withProfile}, the uri of that
    * Activity Type will be used.
    * @param {uri|string} type URI to set the `type` to.
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    * @throws {Error} if `type` does not match a name and is not uri-like.
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
    * Activity Extension will be used.
    * @param {uri|string} key URI key of the extension
    * @param {*} value any JSON-legal data structure
    * @return {ActivityBuilder} returns the updated builder object. The original
    * is unmodified.
    * @throws {Error} if `key` does not match a name and is not uri-like.
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


/**
* Use AttachmentBuilder to make Attachments for use in your Statements.
*
* When working with Statements you should generally get an AttachmentBuilder
* instance by the {@link StatementBuilder#attachments} property.
*
* Note: currently this library does not handle Attachment bodies, though they
* can still be added later, during Statement sending.
*/
export class AttachmentBuilder extends BuilderRecord {

    /**
    * Provide a `usageType` uri
    *
    * If the `uri` is not a URI but matches a name of an Attachment Usage Type
    * in a Profile loaded by {@link StatementBuilder#withProfile}, the uri of
    * that Attachment Usage Type will be used.
    * @param {uri|string} uri the attachment usage type
    * @return {AttachmentBuilder} returns the updated builder object. The
    * original is unmodified.
    * @throws {Error} if `uri` does not match a name and is not uri-like.
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


/**
* Use StatementBuilder to make Statements. If you're not planning to send
* Statements according to a Profile Pattern, this is your starting point.
*
* @example
* var statement = StatementBuilder.builder();
*
* statement = statement.withActorEmail(
*     "zhangwei@example.gov"
* ).withVerb(
*     "http://made.up.verb.example.com/desalinated"
* ).withObjectId(
*     "http://made.up.activity.example.com/PacificOcean"
* );
*
* console.log(statement.build());
*/
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
    * Profile representation of that verb will be used. If a URI is provided
    * will also attempt to load the complete Profile representation.
    * @param {uri|string|Verb} verb the verb URI, name or object.
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    * @throws {Error} if `verb` does not match a name and is not uri-like or an
    * object with an `id`.
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
    * Profile representation of that Activity will be used.
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
    * @throws {Error} if a string argument is not a UUID, does not match a name,
    * and is not uri-like.
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
            if(object instanceof StatementBuilder) {
                object = object.asSubStatement();
            }
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
        if(timestamp instanceof Date) {
            timestamp = timestamp.toISOString();
        }
        return this.withPath(['timestamp'], timestamp);
    }

    /**
    * Set the Statement as occurring at the current time.
    *
    * Note: when .build() is called to turn this into a Statement,
    * if no `timestamp` is set the current time will be used.
    * This method is for if the time the statement occurs is
    * before some information is known for the Statement.
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withCurrentTimestamp() {
        return this.withTimestamp(new Date().toISOString());
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
    * If `duration` is a number, this will automatically convert it to a
    * duration representation in seconds.
    * @param {string|number} duration the `duration`
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    */
    withDuration(duration) {
        if(typeof duration === 'number') {
            duration = 'P' + number + 'S';
        }
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


    /**
    * @ignore
    */
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
    * be used.
    * @param {uri|string} id URI to set the `id` to or name of an Activity from
    * a Profile.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    * @throws {Error} if `id` does not match a name and is not uri-like.
    */
    withObjectId(id) {
        return this.withActivityMethod('withId', arguments);
    }

    /**
    * Makes the Activity object look exactly as in the Profile it is from.
    *
    * If no `id` is provided but one is set for the Activity, that will be used.
    * If the `id` is not a URI but matches a name of an Activity in a Profile
    * loaded by {@link StatementBuilder#withProfile}, that Activity will
    * be used.
    * @param {uri|string} [id] URI or string to lookup the Activity with
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    * @throws {Error} if `id` does not match a name and is not uri-like,
    * or if no `id` is provided or present.
    */
    withObjectAsProfile(id) {
        return this.withActivityMethod('asProfile', arguments);
    }

    /**
    * Set the Activity `object` `type`
    *
    * If the `type` is not a URI but matches a name of an Activity Type in a
    * Profile loaded by {@link StatementBuilder#withProfile}, the uri of that
    * Activity Type will be used.
    * @param {uri|string} type URI to set the `type` to.
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    * @throws {Error} if `type` does not match a name and is not uri-like.
    */
    withObjectType(type) {
        return this.withActivityMethod('withType', arguments);
    }

    /**
    * Add an extension to the Activity `object` `definition`
    *
    * If the `key` is not a URI but matches a name of an Activity Extension in a
    * Profile loaded by {@link StatementBuilder#withProfile}, the uri of that
    * Activity Extension will be used.
    * @param {uri|string} key URI key of the extension
    * @param {*} value any JSON-legal data structure
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    * @throws {Error} if `key` does not match a name and is not uri-like.
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
    * @param {string} [language] an RFC 5646 language tag, such as `en` or
    * `zh-Hans`. Must use for Activity objects, must not use for Agents.
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
        let full_activity;
        if(typeof activity === 'string') {
            full_activity = fromJS(this.lookup(activity, 'Activity'));
        } else if(activity instanceof BuilderRecord) {
            full_activity = activity.map;
        } else {
            full_activity = fromJS(activity);
        }
        return this.updateIn(path,
            (activities = List()) => activities.push(full_activity));
    }


    /**
    * Add an Activity to the `category` `contextActivities` in `context`
    *
    * There are several possible ways to provide the Activity:
    *   * As a name or URI of an Activity. If the Activity is found in a
    * Profile loaded by {@link StatementBuilder#withProfile}, the complete
    * Profile representation of that Activity will be used.
    *   * As a builder from this library for an Activity.
    *   * as a complete simple javascript object of an Activity.
    * @param {uri|string|Object} activity the Activity to use
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    * @throws {Error} if a string activity does not match a name and is not
    * uri-like.
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
    * Profile representation of that Activity will be used.
    *   * As a builder from this library for an Activity.
    *   * as a complete simple javascript object of an Activity.
    * @param {uri|string|Object} activity the Activity to use
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    * @throws {Error} if a string activity does not match a name and is not
    * uri-like.
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
    * Profile representation of that Activity will be used.
    *   * As a builder from this library for an Activity.
    *   * as a complete simple javascript object of an Activity.
    * @param {uri|string|Object} activity the Activity to use
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    * @throws {Error} if a string activity does not match a name and is not
    * uri-like.
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
    * Profile representation of that Activity will be used.
    *   * As a builder from this library for an Activity.
    *   * as a complete simple javascript object of an Activity.
    * @param {uri|string|Object} activity the Activity to use
    * @return {StatementBuilder} returns the updated builder object. The
    * original is unmodified.
    * @throws {Error} if a string activity does not match a name and is not
    * uri-like.
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
    * Context Extension will be used.
    * @param {uri|string} key URI key of the extension
    * @param {*} value any JSON-legal data structure
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    * @throws {Error} if `key` does not match a name and is not uri-like.
    */
    withContextExtension(key, value) {
        return this.withExtension('context', key, value);
    }


    /**
    * Add an extension to the `result`
    *
    * If the `key` is not a URI but matches a name of a Result Extension in a
    * Profile loaded by {@link StatementBuilder#withProfile}, the uri of that
    * Result Extension will be used.
    * @param {uri|string} key URI key of the extension
    * @param {*} value any JSON-legal data structure
    * @return {StatementBuilder} returns the updated builder object. The original
    * is unmodified.
    * @throws {Error} if `key` does not match a name and is not uri-like.
    */
    withResultExtension(key, value) {
        return this.withExtension('result', key, value);
    }




    /**
    * Makes this create a SubStatement (StatementBuilder makes Statements by
    * default)
    *
    * You do not have to call this to use a StatementBuilder as a SubStatement.
    * Just pass another StatementBuilder to {@link StatementBuilder#withObject}
    * and the conversion will be handled automatically.
    * @return {SubStatementBuilder} returns a new builder object. The
    * original is unmodified.
    */
    asSubStatement() {
        // TODO do some checking that the SubStatement doesn't have a
        // SubStatement object itself? Forbid that in the subclass?
        return SubStatementBuilder.builder(this.setIn(
            // required objectType
            ['map', 'objectType'], 'SubStatement'
        ).update(
            'map', (map) => map.deleteAll([
                // get rid of illegal SubStatement properties
                'id',
                'timestamp',
                'version',
                'authority'
            ])
        ));
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
    * Make this Statement follow the rules of a Statement template
    *
    * If the Statement Template has `verb` or `objectActivityType` determining
    * properties, those are set on the Statement. When the Statement is built,
    * all the rules of the Statement Template are checked, as well as the
    * presence of all the determining properties.
    *
    * @param {uri|string|Object} template the URI, name, or full javascript
    * object representation of a Statement Template.
    * @returns {StatementBuilder} a Statement Template-validating
    * StatementBuilder
    * @throws {Error} if a uri or string is passed in and there is no matching
    * Statement Template.
    */
    templated(template) {
        if(typeof template === 'string') {
            template = this.lookup(template, 'StatementTemplate');
            // TODO error handling beyond provided by lookup?
        }

        let statement = this;

        if(template.verb) {
            statement = statement.withVerb(template.verb);
        }
        if(template.objectActivityType) {
            statement = statement.withObjectType(template.objectActivityType);
        }

        const TemplateBuilder = class extends StatementBuilder {

            _error(message) {
                throw new Error("For template " + template.id + ", " + message);
            }

            _multipath(js, expressions) {
                return [].concat(
                    ...expressions.map((expression) =>
                        jsonpath.query(js, expression)
                    )
                );
            }

            _ruleDescription(rule) {
                if(rule.selector) {
                    return `${rule.location} (each refined with ${rule.selector})`;
                } else {
                    return rule.location;
                }
            }

            _checkRule(js, rule) {
                const description = this._ruleDescription(rule);
                // TODO real parsing here for those rare | inside rule cases
                const locations = _.split(rule.location, '|');
                const values = this._multipath(js, locations);
                let has_unmatchable = false;
                let matchables = values;
                if(rule.selector) {
                    // override the above with the results of selection
                    // TODO break all this top stuff into a nice function
                    // TODO do we need to handle the case where
                    // the selector is run on a non-object? If so,
                    // what's the right way to proceed? If we don't,
                    // jsonpath.query will error, as it only works on
                    // objects.
                    const selectors = _.split(rule.selector, '|');
                    const selected = values.map((value) =>
                        this._multipath(value, selectors)
                    );
                    has_unmatchable = !_.isEmpty(selected.filter(_.isEmpty));
                    matchables = [].concat(...selected);
                }

                if(rule.presence === 'included') {
                    if(_.isEmpty(matchables)) {
                        this._error(`${description} must include at least one value, but does not`);
                    }
                    if(has_unmatchable) {
                        this._error(`${description} must not include any unmatchable values, but does`);
                    }
                } else if(rule.presence === 'excluded') {
                    if(!_.isEmpty(matchables)) {
                        this._error(`${description} must not include any values, but does`);
                    }
                }
                if(!rule.presence ||
                    rule.presence === 'included' ||
                    (rule.presence === 'recommended' && !_.isEmpty(matchables))) {
                    if(rule.any && _.isEmpty(_.intersection(rule.any, matchables))) {
                        this._error(`${description} must have at least one value from ${_.join(rule.any)}`);
                    }
                    if(rule.all) {
                        if(!_.isEmpty(_.difference(rule.all, matchables))) {
                            this._error(`${description} must not include any values that aren't from ${_.join(rule.all)}`);
                        }
                        if(has_unmatchable) {
                            this._error(`${description} must not include any unmatchable values, but does`);
                        }
                    }
                    if(rule.none && !_.isEmpty(_.intersection(rule.none, matchables))) {
                        this._error(`${description} must not include any of ${_.join(rule.none)}, but does`);
                    }
                }

            }

            validate(js) {
                super.validate(js);
                // TODO add proactive validation of this vs all other
                // templates in the profile! Those still matter for conformance
                // though probably have that controlled by function caller
                // here, and only automatic in the PatternRegistration.template
                // call.
                if(template.verb && template.verb != _.get(js, 'verb.id')) {
                    this._error(`verb id must be ${template.verb}`);
                }
                if(template.objectActivityType && template.objectActivityType != _.get(js, 'object.definition.type')) {
                    this._error(`object activity type must be ${template.objectActivityType}`);
                }
                for(let name of ["parent", "category", "grouping", "other"]) {
                    const capitalized = capitalize(name);
                    if(template["context${capitalized}ActivityType"]) {
                        const required = template["context${capitalized}ActivityType"];
                        const present = _.get(js, 'context.contextActivities.${name}', []).map((activity) =>
                            _.get(activity, 'definition.type')
                        );
                        const missing = _.difference(required, present);
                        if(!_.isEmpty(missing)) {
                            this._error(`${name} context activity types must include all of ${_.join(missing)}`);
                        }
                    }
                }
                if(template.attachmentUsageType) {
                    const missing = _.difference(template.attachmentUsageType,
                        _.get(js, 'attachments', []).map((attachment) => attachment.usageType)
                    );
                    if(!_.isEmpty(missing)) {
                        this._error(`attachment usage types must include all of ${_.join(missing)}`);
                    }
                }
                if(template.objectStatementRefTemplate && "StatementRef" != _.get(js, 'object.objectType')) {
                    this._error("object must be a StatementRef");
                }
                if(template.contextStatementRefTemplate && !_.get(js, 'context.statement')) {
                    this._error("the context statement must be present");
                }
                if(template.rules) {
                    for(let rule of template.rules) {
                        this._checkRule(js, rule);
                    }
                }
            }
        }


        return TemplateBuilder.builder(statement);
    }
}

/**
* This class is returned when {@link StatementBuilder#asSubStatement} is called.
* It makes sure the disallowed SubStatement properties (id, timestamp, version,
* and authority) are not set.
*/
export class SubStatementBuilder extends StatementBuilder {

    /**
    * @ignore
    */
    withId() {
        throw new Error("That property not allowed in SubStatements");
    }

    /**
    * @ignore
    */
    withTimestamp() {
        throw new Error("That property not allowed in SubStatements");
    }

    /**
    * @ignore
    */
    withVersion() {
        throw new Error("That property not allowed in SubStatements");
    }

    /**
    * @ignore
    */
    withAuthority() {
        throw new Error("That property not allowed in SubStatements");
    }

    /**
    * @ignore
    */
    withAgentMethod(location) {
        if(location[0] === 'authority') {
            throw new Error("That property not allowed in SubStatements");
        }
        return super.withAgentMethod(...arguments);
    }
}
