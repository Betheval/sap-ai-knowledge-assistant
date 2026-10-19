using {knowledge} from '../db/schema';

@requires: 'KnowledgeUser'
service KnowledgeService {

  @readonly
  @restrict: [{
    grant: 'READ',
    where: 'createdBy = $user'
  }]
  entity Conversations  as projection on knowledge.Conversations;

  @readonly
  @restrict: [{
    grant: 'READ',
    where: 'createdBy = $user'
  }]
  entity Messages       as projection on knowledge.Messages;

  @readonly
  @restrict: [{
    grant: 'READ',
    where: 'message.createdBy = $user'
  }]
  entity MessageSources as projection on knowledge.MessageSources;

  type Source {
    title   : String;
    url     : String;
    snippet : LargeString;
    score   : Double;
    cited   : Boolean;
  }

  type AskResult {
    conversationId : UUID;
    messageId      : UUID;
    answer         : LargeString;
    sources        : many Source;
    model          : String;
    latencyMs      : Integer;
  }

  /**
   * Asks a question. Starts a new conversation when conversationId is empty,
   * otherwise continues the given conversation (ADR 0006).
   */
  action ask(conversationId : UUID, question : String not null) returns AskResult;
}
