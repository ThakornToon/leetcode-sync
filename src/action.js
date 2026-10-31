const axios = require('axios');
const { Octokit } = require('@octokit/rest');

const COMMIT_MESSAGE = 'Sync LeetCode submission';
const LANG_TO_EXTENSION = {
  'bash': 'sh',
  'c': 'c',
  'cpp': 'cpp',
  'csharp': 'cs',
  'dart': 'dart',
  'elixir': 'ex',
  'erlang': 'erl',
  'golang': 'go',
  'java': 'java',
  'javascript': 'js',
  'kotlin': 'kt',
  'mssql': 'sql',
  'mysql': 'sql',
  'oraclesql': 'sql',
  'php': 'php',
  'postgresql': 'sql',
  'python': 'py',
  'python3': 'py',
  'pythondata': 'py',
  'racket': 'rkt',
  'ruby': 'rb',
  'rust': 'rs',
  'scala': 'scala',
  'swift': 'swift',
  'typescript': 'ts',
};
const BASE_URL = 'https://leetcode.com';

const delay = ms => new Promise(res => setTimeout(res, ms));

function log(message) {
  console.log(`[${new Date().toUTCString()}] ${message}`);
}

function normalizeName(problemName) {
  return problemName.toLowerCase().replace(/\s/g, '_');
}

function graphqlHeaders(session, csrfToken) {
  return {
    'content-type': 'application/json',
    origin: BASE_URL,
    referer: BASE_URL,
    cookie: `csrftoken=${csrfToken}; LEETCODE_SESSION=${session};`,
    'x-csrftoken': csrfToken,
  };
}

async function getSubmissionCode(submission, session, csrfToken) {
  const data = JSON.stringify({
    query: `query submissionDetails($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) {
        code
      }
    }`,
    variables: { submissionId: Number(submission.id) },
  });

  const headers = graphqlHeaders(session, csrfToken);

  const getCode = async (maxRetries = 5, retryCount = 0) => {
    try {
      const response = await axios.post('https://leetcode.com/graphql/', data, {
        headers,
      });
      const code = response.data?.data?.submissionDetails?.code;
      if (!code) {
        log(`No code returned for submission #${submission.id}`);
        return null;
      }
      log(`Got code for submission #${submission.id}`);
      return code;
    } catch (exception) {
      // If problem is locked due to user not having LeetCode Premium
      if (exception.response && exception.response.status === 403) {
        log(`Skipping locked problem: ${submission.title}`);
        return null;
      }
      if (retryCount >= maxRetries) {
        throw exception;
      }
      log(
        'Error fetching submission info, retrying in ' +
          3 ** retryCount +
          ' seconds...'
      );
      await delay(3 ** retryCount * 1000);
      return getCode(maxRetries, retryCount + 1);
    }
  };

  return await getCode();
}

async function getQuestionData(titleSlug, session, csrfToken) {
  log(`Getting question data for ${titleSlug}...`);

  const data = JSON.stringify({
    query: `query getQuestionDetail($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        content
      }
    }`,
    variables: { titleSlug: titleSlug },
  });

  const headers = graphqlHeaders(session, csrfToken);

  const fetchQuestion = async (maxRetries = 5, retryCount = 0) => {
    try {
      const response = await axios.post('https://leetcode.com/graphql/', data, {
        headers,
      });
      const content = response.data?.data?.question?.content;
      return content ?? 'Unable to fetch the Problem statement.';
    } catch (exception) {
      // If problem is locked due to user not having LeetCode Premium
      if (exception.response && exception.response.status === 403) {
        log(`Skipping locked problem: ${titleSlug}`);
        return null;
      }
      if (retryCount >= maxRetries) {
        log(`Error fetching question data for ${titleSlug}: ${exception.message}`);
        return 'Unable to fetch the Problem statement.';
      }
      log(
        'Error fetching question data, retrying in ' +
          3 ** retryCount +
          ' seconds...'
      );
      await delay(3 ** retryCount * 1000);
      return fetchQuestion(maxRetries, retryCount + 1);
    }
  };

  return await fetchQuestion();
}

async function commit(params) {
  const {
    octokit,
    owner,
    repo,
    defaultBranch,
    commitInfo,
    treeSHA,
    latestCommitSHA,
    submission,
    destinationFolder,
    questionData
  } = params;

  const name = normalizeName(submission.title);
  log(`Committing solution for ${name}...`);

  if (!LANG_TO_EXTENSION[submission.lang]) {
    throw `Language ${submission.lang} does not have a registered extension.`;
  }

  const prefix = !!destinationFolder ? `${destinationFolder}/` : '';
  const solutionPath = `${prefix}problems/${name}/solution.${LANG_TO_EXTENSION[submission.lang]}`;
  const questionPath = `${prefix}problems/${name}/README.md`;

  const treeData = [
    {
      path: questionPath,
      mode: '100644',
      content: questionData ?? 'Unable to fetch the Problem statement.',
    },
    {
      path: solutionPath,
      mode: '100644',
      content: submission.code,
    }
  ];

  const treeResponse = await octokit.git.createTree({
    owner: owner,
    repo: repo,
    base_tree: treeSHA,
    tree: treeData,
  });

  const date = new Date(Number(submission.timestamp) * 1000).toISOString();
  const commitResponse = await octokit.git.createCommit({
    owner: owner,
    repo: repo,
    message: `${COMMIT_MESSAGE} - ${submission.title} (${submission.lang})`,
    tree: treeResponse.data.sha,
    parents: [latestCommitSHA],
    author: {
      email: commitInfo.email,
      name: commitInfo.name,
      date: date,
    },
    committer: {
      email: commitInfo.email,
      name: commitInfo.name,
      date: date,
    },
  });

  await octokit.git.updateRef({
    owner: owner,
    repo: repo,
    sha: commitResponse.data.sha,
    ref: 'heads/' + defaultBranch,
    force: true
  });

  log(`Committed solution for ${name}`);

  return [treeResponse.data.sha, commitResponse.data.sha];
}

// Returns false if no more submissions should be added.
function addToSubmissions(params) {
  const {
    response,
    lastTimestamp,
    filterDuplicateSecs,
    submissions_dict,
    submissions
  } = params;

  const submissionsList = response.data?.data?.submissionList?.submissions;
  if (!submissionsList) {
    return false;
  }

  for (const submission of submissionsList) {
    const submissionTimestamp = Number(submission.timestamp);
    if (submissionTimestamp <= lastTimestamp) {
      return false;
    }
    if (submission.statusDisplay !== 'Accepted') {
      continue;
    }
    const name = normalizeName(submission.title);
    const lang = submission.lang;
    if (!submissions_dict[name]) {
      submissions_dict[name] = {};
    }
    // Filter out other accepted solutions less than one day from the most recent one.
    if (
      submissions_dict[name][lang] &&
      submissions_dict[name][lang] - submissionTimestamp < filterDuplicateSecs
    ) {
      continue;
    }
    submissions_dict[name][lang] = submissionTimestamp;
    submission.timestamp = submissionTimestamp;
    submissions.push(submission);
  }
  return true;
}

async function sync(inputs) {
  const {
    githubToken,
    owner,
    repo,
    filterDuplicateSecs,
    leetcodeCSRFToken,
    leetcodeSession,
    destinationFolder
  } = inputs;

  const octokit = new Octokit({
    auth: githubToken,
    userAgent: 'LeetCode sync to GitHub - GitHub Action',
  });
  // First, get the time the timestamp for when the syncer last ran.
  const commits = await octokit.repos.listCommits({
    owner: owner,
    repo: repo,
    per_page: 100,
  });

  let lastTimestamp = 0;
  // commitInfo is used to get the original name / email to use for the author / committer. 
  // Since we need to modify the commit time, we can't use the default settings for the
  // authenticated user.
  let commitInfo = commits.data[commits.data.length - 1].commit.author;
  for (const commit of commits.data) {
    if (!commit.commit.message.startsWith(COMMIT_MESSAGE)) {
      continue;
    }
    commitInfo = commit.commit.author;
    lastTimestamp = Date.parse(commit.commit.committer.date) / 1000;
    break;
  }

  // Get all Accepted submissions from LeetCode greater than the timestamp.
  let response = null;
  let offset = 0;
  const submissions = [];
  const submissions_dict = {};
  do {
    log(`Getting submission from LeetCode, offset ${offset}`);

    const getSubmissions = async (maxRetries, retryCount = 0) => {
      try {
        const graphql = JSON.stringify({
          query: `query ($offset: Int!, $limit: Int!, $slug: String) {
              submissionList(offset: $offset, limit: $limit, questionSlug: $slug) {
                  hasNext
                  submissions {
                      id
                      lang
                      timestamp
                      statusDisplay
                      runtime
                      title
                      memory
                      titleSlug
                  }
              }
          }`,
          variables: {
            offset: offset,
            limit: 20,
            slug: undefined,
          },
        });

        const headers = graphqlHeaders(leetcodeSession, leetcodeCSRFToken);
        const response = await axios.post(
          'https://leetcode.com/graphql/',
          graphql,
          { headers }
        );

        if (response.data && response.data.errors && !response.data.data?.submissionList) {
          throw new Error(`LeetCode GraphQL error: ${JSON.stringify(response.data.errors)}`);
        }

        log(`Successfully fetched submission from LeetCode, offset ${offset}`);
        return response;
      } catch (exception) {
        if (retryCount >= maxRetries) {
          throw exception;
        }
        log(
          'Error fetching submissions, retrying in ' +
            3 ** retryCount +
            ' seconds...'
        );
        // There's a rate limit on LeetCode API, so wait with backoff before retrying. 
        await delay(3 ** retryCount * 1000);
        return getSubmissions(maxRetries, retryCount + 1);
      }
    };

    // On the first attempt, there should be no rate limiting issues, so we fail immediately in case
    // the tokens are configured incorrectly.
    const maxRetries = response === null ? 0 : 5;
    if (response !== null) {
      // Add a 1 second delay before all requests after the initial request. 
      await delay(1000);
    }
    response = await getSubmissions(maxRetries);
    if (
      !addToSubmissions({
        response,
        lastTimestamp,
        filterDuplicateSecs,
        submissions_dict,
        submissions,
      })
    ) {
      break;
    }

    offset += 20;
  } while (response.data?.data?.submissionList?.hasNext);

  // We have all submissions we want to write to GitHub now.
  // First, get the default branch to write to.
  const repoInfo = await octokit.repos.get({
    owner: owner,
    repo: repo,
  });
  const defaultBranch = repoInfo.data.default_branch;
  log(`Default branch for ${owner}/${repo}: ${defaultBranch}`);

  // Write in reverse order (oldest first), so that if there's errors, the last sync time
  // is still valid.
  log(`Syncing ${submissions.length} submissions...`);
  let latestCommitSHA = commits.data[0].sha;
  let treeSHA = commits.data[0].commit.tree.sha;
  const questionDataCache = {};
  for (let i = submissions.length - 1; i >= 0; i--) {
    const submission = submissions[i];
    const code = await getSubmissionCode(
      submission,
      leetcodeSession,
      leetcodeCSRFToken
    );
    if (!code) {
      log(`Skipping submission #${submission.id} (${submission.title})`);
      continue;
    }
    submission.code = code;

    let questionData = null;
    if (submission.titleSlug) {
      if (questionDataCache[submission.titleSlug] !== undefined) {
        questionData = questionDataCache[submission.titleSlug];
      } else {
        questionData = await getQuestionData(
          submission.titleSlug,
          leetcodeSession,
          leetcodeCSRFToken
        );
        questionDataCache[submission.titleSlug] = questionData;
      }

      if (questionData === null) {
        log(`Skipping submission #${submission.id} (${submission.title}) due to locked question`);
        continue;
      }
    }

    [treeSHA, latestCommitSHA] = await commit({
      octokit,
      owner,
      repo,
      defaultBranch,
      commitInfo,
      treeSHA,
      latestCommitSHA,
      submission,
      destinationFolder,
      questionData
    });
  }
  log('Done syncing all submissions.');
}

module.exports = { log, sync };
