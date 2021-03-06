/* eslint-disable @typescript-eslint/no-unused-vars */

import * as core from '@actions/core'
import {
  context as githubContext,
  GitHub as actionsGitHub
} from '@actions/github'
import * as exec from '@actions/exec'
import nodeFetch from 'node-fetch'
import {execSync as childProcessExecSync, spawn} from 'child_process'
import * as marked from 'marked'
import * as t from 'io-ts'
import {isRight} from 'fp-ts/lib/Either'
import * as fs from 'fs'

const commentAuthorAssociationsType = t.array(t.string)

const commentPrefix = '@github-actions run'

async function run(): Promise<void> {
  try {
    // Avoid mangling
    const context = githubContext
    // Avoid mangling
    const GitHub = actionsGitHub
    // Avoid mangling
    const fetch = nodeFetch
    // Avoid mangling
    const execSync = childProcessExecSync
    const githubToken = core.getInput('github-token', {required: true})
    if (context.eventName === 'issue_comment') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const comment: string = (context.payload as any).comment.body
      // If not command-run-request comment
      if (!comment.startsWith(commentPrefix)) {
        // eslint-disable-next-line no-console
        console.log(
          `HINT: Comment-run is triggered when your comment start with "${commentPrefix}"`
        )
        return
      }
      // Get allowed associations
      const allowedAssociationsStr = core.getInput('allowed-associations')
      // Parse and validate
      const allowedAssociationsEither = commentAuthorAssociationsType.decode(
        JSON.parse(allowedAssociationsStr)
      )
      if (!isRight(allowedAssociationsEither)) {
        // eslint-disable-next-line no-console
        console.error(
          `ERROR: Invalid allowed-associations: ${allowedAssociationsStr}`
        )
        return
      }
      const allowedAssociations: string[] = allowedAssociationsEither.right
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const association = (context.payload as any).comment.author_association
      // If commenting user is not allowed to run scripts
      if (!allowedAssociations.includes(association)) {
        // eslint-disable-next-line no-console
        console.warn(
          `NOTE: The allowed associations to run scripts are ${allowedAssociationsStr}, but you are ${association}.`
        )
        return
      }
      // Create GitHub client which can be used in the user script
      const githubClient = new GitHub(githubToken)
      // Post GitHub issue comment
      const postComment = async (body: string): Promise<void> => {
        await githubClient.issues.createComment({
          // eslint-disable-next-line @typescript-eslint/camelcase
          issue_number: context.issue.number,
          owner: context.repo.owner,
          repo: context.repo.repo,
          body
        })
      }
      // Parse the comment
      const tokens = marked.lexer(comment)
      for (const token of tokens) {
        if (token.type === 'code') {
          if (token.lang === 'js' || token.lang === 'javascript') {
            // Eval JavaScript
            // NOTE: Eval result can be promise
            await eval(token.text)
          } else if (token.text.startsWith('#!')) {
            // Execute script with shebang
            await executeShebangScript(token.text)
          }
        }
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn(`event name is not 'issue_comment': ${context.eventName}`)
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

function createTmpFileName(): string {
  const prefix = 'tmp_'
  const len = 32
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const fileName = `${prefix}${randomString(len)}`
    if (!fs.existsSync(fileName)) return fileName
  }
}

// (base: https://stackoverflow.com/a/1349426/2885946)
function randomString(length: number): string {
  let result = ''
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const charactersLength = characters.length
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength))
  }
  return result
}

async function executeShebangScript(script: string): Promise<void> {
  // NOTE: Executing file in /tmp cause the error "UnhandledPromiseRejectionWarning: Error: There was an error when attempting to execute the process '/tmp/tmp-26373utihbUOauHW'. This may indicate the process failed to start. Error: spawn /tmp/tmp-26373utihbUOauHW ENOENT"
  const fpath = createTmpFileName()
  try {
    fs.writeFileSync(fpath, script)
    fs.chmodSync(fpath, 0o777)
    await exec.exec(`./${fpath}`, [], {
      outStream: process.stdout,
      errStream: process.stderr
    })
  } finally {
    // Remove file
    fs.unlinkSync(fpath)
  }
}

run()
